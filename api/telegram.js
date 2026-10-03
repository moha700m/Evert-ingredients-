import { cfg } from './_lib/config.js';
import { tg, sendMessage, sendLongMessage, answerCallbackQuery, categoryButton } from './_lib/telegram.js';
import { fetchProducts, purchaseProduct, canAutoPurchase, canPurchaseWithInput } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';

const CATEGORIES = [
  { slug: 'chatgpt', label: 'ChatGPT', icon: '🤖', re: /chatgpt|openai/i },
  { slug: 'google', label: 'Google', icon: '🌈', re: /google one|gemini|google/i },
  { slug: 'apple', label: 'Apple', icon: '🍎', re: /apple\s*id|icloud|\bapple\b/i },
  { slug: 'capcut', label: 'CapCut', icon: '🎬', re: /capcut/i },
  { slug: 'gmail', label: 'Gmail', icon: '📧', re: /gmail|google mail/i },
  { slug: 'canva', label: 'Canva', icon: '🎨', re: /canva/i },
  { slug: 'claude', label: 'Claude', icon: '🟠', re: /claude/i },
  { slug: 'meitu', label: 'Meitu', icon: '📸', re: /meitu/i },
  { slug: 'nordvpn', label: 'NordVPN', icon: '🛡️', re: /nord\s?vpn/i },
  { slug: 'telegram', label: 'Telegram', icon: '✈️', re: /telegram/i },
  { slug: 'hmavpn', label: 'HMA VPN', icon: '🥷', re: /hma|hide my ass/i },
  { slug: 'notion', label: 'Notion', icon: '📝', re: /notion/i },
  { slug: 'autodesk', label: 'AutoDesk', icon: '🏗️', re: /autodesk/i },
  { slug: 'scribd', label: 'SCRIBD', icon: '📚', re: /scribd/i },
  { slug: 'cursor', label: 'Cursor', icon: '🖱️', re: /cursor/i },
  { slug: 'kling', label: 'Kling', icon: '🎞️', re: /kling/i },
  { slug: 'youtube', label: 'Youtube', icon: '▶️', re: /youtube/i },
  { slug: 'zoom', label: 'Zoom', icon: '📹', re: /zoom/i },
  { slug: 'outlook', label: 'Outlook', icon: '📬', re: /outlook|hotmail/i },
  { slug: 'tiktok', label: 'TikTok', icon: '🎵', re: /tiktok|tik tok/i },
  { slug: 'figma', label: 'Figma', icon: '🧩', re: /figma/i },
  { slug: 'duolingo', label: 'Duolingo', icon: '🦉', re: /duolingo/i },
  { slug: 'krea', label: 'Krea', icon: '🖼️', re: /\bkrea\b/i },
  { slug: 'wink', label: 'Wink', icon: '✨', re: /\bwink\b/i },
  { slug: 'adobe', label: 'Adobe', icon: '🅰️', re: /adobe/i },
  { slug: 'tradingview', label: 'TradingView', icon: '📈', re: /trading\s?view/i },
  { slug: 'microsoft', label: 'Microsoft', icon: '🪟', re: /microsoft|office\s?365|m365/i },
  { slug: 'lovable', label: 'Lovable', icon: '💜', re: /lovable/i },
  { slug: 'seedance', label: 'Seedance', icon: '🎥', re: /seedance/i },
  { slug: 'quizlet', label: 'Quizlet', icon: '🧠', re: /quizlet/i },
  { slug: 'hotspot', label: 'Hotspot VPN', icon: '🌐', re: /hotspot/i },
  { slug: 'spotify', label: 'Spotify', icon: '🎧', re: /spotify/i },
  { slug: 'perplexity', label: 'Perplexity', icon: '🔎', re: /perplexity/i },
];

function livePurchases(runtime) {
  return typeof runtime?.livePurchases === 'boolean' ? runtime.livePurchases : cfg.livePurchases();
}

function priceToStars(price, runtime) {
  if (!Number.isFinite(price) || price < 0) return null;
  const rate = Number(runtime?.starRate) > 0 ? Number(runtime.starRate) : cfg.starRate();
  const markup = Number.isFinite(Number(runtime?.markupPercent)) ? Number(runtime.markupPercent) : cfg.markup();
  return Math.max(1, Math.ceil(price * rate * (1 + markup / 100)));
}

async function visibleProducts() {
  return fetchProducts();
}

async function findProduct(key, runtime) {
  return (await visibleProducts(runtime)).find(product => product.key === key) || null;
}

function short(value, max = 34) {
  const text = String(value || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!text) return 'منتج';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function detailText(value, max = 700) {
  const text = String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

function requirementSummary(value) {
  const parts = [];

  function add(valueToAdd) {
    const text = String(valueToAdd || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^(true|false|null|undefined)$/i.test(text)) return;
    if (!parts.some(part => part.toLowerCase() === text.toLowerCase())) parts.push(text);
  }

  function walk(node, key = '') {
    if (parts.length >= 8 || node == null) return;
    if (typeof node === 'string') {
      const clean = node.trim();
      if (clean) add(key && clean.toLowerCase() !== key.toLowerCase() ? `${key}: ${clean}` : clean);
      return;
    }
    if (typeof node === 'boolean') {
      if (node && key) add(key);
      return;
    }
    if (typeof node === 'number') {
      if (key) add(`${key}: ${node}`);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    if (typeof node === 'object') {
      const preferred = ['label', 'name', 'title', 'description', 'placeholder'];
      let usedPreferred = false;
      for (const field of preferred) {
        if (typeof node[field] === 'string' && node[field].trim()) {
          add(node[field]);
          usedPreferred = true;
        }
      }
      for (const [childKey, child] of Object.entries(node)) {
        if (preferred.includes(childKey)) continue;
        if (usedPreferred && ['required', 'type'].includes(childKey)) continue;
        walk(child, childKey);
      }
    }
  }

  walk(value);
  return parts.slice(0, 6).join(' • ');
}

function categoryOf(product) {
  const haystack = `${product?.name || ''} ${product?.description || ''}`;
  return CATEGORIES.find(category => category.re.test(haystack)) || { slug: 'other', label: 'أخرى', icon: '📦', re: /.*/ };
}

function categoryGroups(products) {
  const groups = new Map();
  for (const product of products) {
    const category = categoryOf(product);
    if (!groups.has(category.slug)) groups.set(category.slug, { category, products: [] });
    groups.get(category.slug).products.push(product);
  }
  return groups;
}

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function bottomKeyboard() {
  return {
    keyboard: [
      [{ text: '🛍 Products' }, { text: '💬 Support' }],
      [{ text: '👛 Wallet' }, { text: '🔗 API' }],
      [{ text: '🛡 Warranty' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'اختر من القائمة…',
  };
}

async function showNativeHome(chatId, runtime) {
  const title = runtime?.storeTitle || 'كل شي';
  const welcome = runtime?.welcomeMessage || `هلا 👋\nحياك في ${title}. اختر الخدمة اللي تبيها ✨`;
  await sendMessage(chatId, welcome, { reply_markup: bottomKeyboard() });
  return showCategories(chatId, runtime);
}

async function showCategories(chatId, runtime) {
  const products = await visibleProducts(runtime);
  const groups = categoryGroups(products);
  const ordered = CATEGORIES.map(category => groups.get(category.slug)).filter(Boolean);
  if (groups.has('other')) ordered.push(groups.get('other'));

  const buttons = ordered.map(group => categoryButton(group.category.slug, group.category.label));

  return sendMessage(chatId, 'اختر الخدمة اللي تبيها 👇', {
    reply_markup: { inline_keyboard: chunk(buttons, 3) },
  });
}

function productEmoji(product) {
  const text = `${product?.name || ''} ${product?.description || ''}`;
  const rules = [
    [/apple\s*id|icloud|\bapple\b/i, '🍎'],
    [/chatgpt|gpt|codex|openai/i, '🤖'],
    [/grok|\bai\b|gemini|claude/i, '🧠'],
    [/netflix|vieon|\btv\b|video|stream/i, '🎬'],
    [/bank|\bmb\b|payment|pay/i, '💳'],
    [/vpn/i, '🛡️'],
    [/music|spotify|بودكاست/i, '🎧'],
    [/e-?mail|mail/i, '📧'],
    [/voucher|gift/i, '🎟️'],
    [/account/i, '👤'],
  ];
  const hit = rules.find(([re]) => re.test(text));
  return hit ? hit[1] : '📦';
}

function durationTag(text) {
  const match = String(text).match(/(\d+)\s*[- ]?\s*(months?|mos?|m|days?|d|years?|yrs?|y|weeks?|w)\b/i);
  if (!match) return '';
  const unit = match[2][0].toUpperCase();
  return `${match[1]}${unit}`;
}

function normalizeDurations(text) {
  return text.replace(/(\d+)\s*[- ]?\s*(months?|mos?|days?|years?|yrs?|weeks?)\b/ig, (_, n, u) => `${n}${u[0].toUpperCase()}`);
}

function trimLabel(text, max = 18) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space >= 6 ? cut.slice(0, space) : cut).trim();
}

function compactProductName(product) {
  const raw = String(product?.name || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();
  const duration = durationTag(raw);
  const withDuration = base => trimLabel(`${base}${duration ? ` ${duration}` : ''}`);

  if (/codex/.test(lower)) {
    const quota = raw.match(/\b(\d+)\s*M\b(?!\w)/);
    const rest = quota ? raw.replace(quota[0], '') : raw;
    const restDuration = durationTag(rest);
    return trimLabel(`${quota ? `${quota[1]}M ` : ''}Codex${restDuration ? ` ${restDuration}` : ''}`);
  }
  if (/chat\s*gpt|\bgpt\b|openai/.test(lower)) {
    const tier = /\bpro\b/.test(lower) ? 'Pro' : /\bteam\b/.test(lower) ? 'Team' : 'Plus';
    return withDuration(`GPT ${tier}`);
  }
  if (/gmail|google mail/.test(lower)) return withDuration('Gmail New');
  if (/youtube/.test(lower)) return withDuration('YouTube');
  if (/apple\s*id/.test(lower)) return 'Apple ID 2FA';
  if (/icloud/.test(lower)) return withDuration('iCloud');
  if (/\bgrok\b/.test(lower)) return withDuration('Grok');
  if (/vieon/.test(lower)) return withDuration('VieON VIP');
  if (/netflix/.test(lower)) return withDuration(`Netflix${/4k/i.test(raw) ? ' 4K' : ''}`);
  if (/\bmb\b|bank|voucher/.test(lower) && /\bmb\b|bank/.test(lower)) return 'MB Voucher';
  if (/voucher/.test(lower)) return withDuration('Voucher');

  const cleaned = normalizeDurations(raw)
    .replace(/\b(full warranty|warranty|guarantee|guaranteed|full|complete|comes? with|premium|account)\b/ig, '')
    .replace(/[-–—|,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return trimLabel(cleaned || raw);
}

function productGridLabel(product) {
  return `${productEmoji(product)} ${compactProductName(product)}`;
}

async function showCategory(chatId, slug, runtime, page = 1) {
  const products = await visibleProducts(runtime);
  const group = categoryGroups(products).get(slug);
  if (!group || !group.products.length) return sendMessage(chatId, 'حالياً ما فيه منتجات بهالقسم.');

  const configured = Number(runtime?.productsPageSize);
  const wanted = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 20) : 8;
  const pageSize = Math.max(4, Math.ceil(wanted / 2) * 2);
  const totalPages = Math.max(1, Math.ceil(group.products.length / pageSize));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), totalPages);
  const items = group.products.slice((current - 1) * pageSize, current * pageSize);

  const productButtons = items.map(product => ({ text: productGridLabel(product), callback_data: `p:${product.key}` }));
  const rows = chunk(productButtons, 2);

  if (totalPages > 1) {
    const nav = [];
    if (current > 1) nav.push({ text: '◀️ السابق', callback_data: `catp:${slug}:${current - 1}` });
    nav.push({ text: `${current}/${totalPages}`, callback_data: `catp:${slug}:${current}` });
    if (current < totalPages) nav.push({ text: 'التالي ▶️', callback_data: `catp:${slug}:${current + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: '⬅️ رجوع للأقسام', callback_data: 'cats' }]);

  const pageInfo = totalPages > 1 ? ` (${current}/${totalPages})` : '';
  return sendMessage(chatId, `${group.category.icon} ${group.category.label}${pageInfo}\nاختر المنتج:`, {
    reply_markup: { inline_keyboard: rows },
  });
}

function accountMarker(key, total, index) {
  return `#REQ:${key}:${total}:${index}`;
}

function previousAccounts(promptText) {
  const accounts = [];
  const re = /✅ الحساب \d+: ([^\n]+)/g;
  let match;
  while ((match = re.exec(String(promptText || '')))) accounts.push(match[1].trim());
  return accounts;
}

function parseAccountPrompt(promptText) {
  const match = String(promptText || '').match(/#REQ:([a-f0-9]{12}):([1-3]):([1-3])/i);
  if (!match) return null;
  return {
    key: match[1],
    total: Number(match[2]),
    index: Number(match[3]),
    accounts: previousAccounts(promptText),
  };
}

function validCustomerEmail(value) {
  const email = String(value || '').trim();
  return email.length >= 5 && email.length <= 90 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function askForAccount(chatId, key, total, index, accounts = []) {
  const previous = accounts.map((email, i) => `✅ الحساب ${i + 1}: ${email}`);
  const lines = [
    `📧 الحساب ${index} من ${total}`,
    '',
    'أرسل بريد الحساب اللي تبي يتفعل عليه الاشتراك.',
    'مثال: name@gmail.com',
    'لا ترسل كلمة المرور — نحتاج البريد فقط.',
  ];
  if (previous.length) lines.push('', ...previous);
  lines.push('', accountMarker(key, total, index));

  return sendMessage(chatId, lines.join('\n'), {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'name@gmail.com',
    },
  });
}

async function startInputFlow(chatId, key, total, runtime) {
  if (!livePurchases(runtime)) return sendMessage(chatId, 'الشراء مقفل مؤقتاً، تقدر تتصفح لين يرجع يشتغل.');
  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');
  if (!canPurchaseWithInput(product)) return sendMessage(chatId, 'متطلبات هالخدمة ما هي مدعومة تلقائياً حالياً.');
  if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) return sendMessage(chatId, 'الخدمة خلصت حالياً.');
  return askForAccount(chatId, key, Math.min(3, Math.max(1, Number(total) || 1)), 1, []);
}

function inputInvoicePayload(key, stars, email) {
  const payload = `buyi:${key}:${stars}:${encodeURIComponent(email)}`;
  return Buffer.byteLength(payload, 'utf8') <= 128 ? payload : null;
}

async function sendInputInvoice(chatId, user, key, runtime, email, index, total) {
  const product = await findProduct(key, runtime);
  if (!product || !canPurchaseWithInput(product)) return sendMessage(chatId, `❌ تعذر تجهيز فاتورة الحساب ${index}.`);
  const stars = priceToStars(product.price, runtime);
  if (!stars) return sendMessage(chatId, `❌ السعر غير متوفر للحساب ${index}.`);
  const payload = inputInvoicePayload(product.key, stars, email);
  if (!payload) return sendMessage(chatId, `❌ بريد الحساب ${index} طويل أكثر من الحد المدعوم.`);

  return tg('sendInvoice', {
    chat_id: chatId,
    title: short(product.name, 32),
    description: `الحساب ${index}/${total}: ${email}`.slice(0, 255),
    payload,
    currency: 'XTR',
    prices: [{ label: `الحساب ${index}`, amount: stars }],
  });
}

async function handleAccountReply(message, runtime) {
  const state = parseAccountPrompt(message.reply_to_message?.text);
  if (!state) return false;

  const email = String(message.text || '').trim();
  if (!validCustomerEmail(email)) {
    await sendMessage(message.chat.id, '❌ البريد مو واضح. ارسله بالشكل هذا: name@gmail.com');
    await askForAccount(message.chat.id, state.key, state.total, state.index, state.accounts);
    return true;
  }

  const accounts = [...state.accounts, email];
  if (state.index < state.total) {
    await askForAccount(message.chat.id, state.key, state.total, state.index + 1, accounts);
    return true;
  }

  await sendMessage(
    message.chat.id,
    `✅ استلمت ${accounts.length} ${accounts.length === 1 ? 'حساب' : 'حسابات'}.\nكل حساب له فاتورة مستقلة لأن المورد ينفذ حساب واحد بكل طلب.`,
  );

  for (let i = 0; i < accounts.length; i += 1) {
    await sendInputInvoice(message.chat.id, message.from, state.key, runtime, accounts[i], i + 1, accounts.length);
  }
  return true;
}

async function showProduct(chatId, key, runtime) {
  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');

  const stars = priceToStars(product.price, runtime);
  const available = product?.availability?.available;
  const inStock = typeof available !== 'number' || available > 0;
  const auto = canAutoPurchase(product);
  const inputPurchase = canPurchaseWithInput(product);
  const category = categoryOf(product);
  const description = detailText(product.description);
  const requirements = requirementSummary(product.purchaseRequirements);

  const lines = [
    `${category.icon} ${short(product.name, 90)}`,
    '',
  ];

  if (description) lines.push(description, '');
  lines.push(stars ? `⭐ السعر: ${stars} نجمة` : '⭐ السعر: غير متوفر');
  if (typeof available === 'number') lines.push(available > 0 ? `📦 المتاح: ${available}` : '⛔ غير متوفر حالياً');
  if (inputPurchase) lines.push('📧 المطلوب: بريد الحساب فقط — بدون كلمة مرور.');
  else if (requirements) lines.push(`📝 المطلوب: ${requirements}`);
  else if (product.requiresInput) lines.push('📝 يحتاج بيانات من العميل قبل التنفيذ.');
  else if (!auto) lines.push('⚠️ هذا المنتج يحتاج تنفيذ خاص قبل الشراء.');

  const keyboard = { inline_keyboard: [] };
  if (stars && inStock && auto) {
    keyboard.inline_keyboard.push([{ text: '⭐ شراء الآن', callback_data: `buy:${product.key}` }]);
  } else if (stars && inStock && inputPurchase) {
    keyboard.inline_keyboard.push([
      { text: '🛒 حساب واحد', callback_data: `form:${product.key}:1` },
      { text: '🛒 حسابين', callback_data: `form:${product.key}:2` },
    ]);
    keyboard.inline_keyboard.push([{ text: '🛒 3 حسابات', callback_data: `form:${product.key}:3` }]);
  }
  keyboard.inline_keyboard.push([{ text: `⬅️ ${category.label}`, callback_data: `cat:${category.slug}` }]);

  return sendMessage(chatId, lines.join('\n'), { reply_markup: keyboard });
}

async function startInvoice(chatId, user, key, runtime) {
  if (!livePurchases(runtime)) return sendMessage(chatId, 'الشراء مقفل مؤقتاً، تقدر تتصفح لين يرجع يشتغل.');
  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');
  if (!canAutoPurchase(product)) return sendMessage(chatId, 'هالخدمة تحتاج بيانات إضافية قبل التنفيذ.');
  if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) return sendMessage(chatId, 'الخدمة خلصت حالياً.');
  const stars = priceToStars(product.price, runtime);
  if (!stars) return sendMessage(chatId, 'السعر مو متوفر حالياً.');

  return tg('sendInvoice', {
    chat_id: chatId,
    title: short(product.name, 32),
    description: 'خدمة رقمية جاهزة — الدفع آمن عن طريق Telegram Stars.',
    payload: `buy:${product.key}:${stars}`,
    currency: 'XTR',
    prices: [{ label: 'الخدمة', amount: stars }],
  });
}

function parseInvoicePayload(payload) {
  const parts = String(payload || '').split(':');
  const kind = parts[0];
  const key = parts[1] || '';
  const charged = Number(parts[2]);
  let customerEmail = '';
  if (kind === 'buyi' && parts[3]) {
    try { customerEmail = decodeURIComponent(parts.slice(3).join(':')); } catch { customerEmail = ''; }
  }
  return { kind, key, charged, customerEmail };
}

async function validateCheckout(query, runtime) {
  try {
    const payload = parseInvoicePayload(query.invoice_payload);
    if (!['buy', 'buyi'].includes(payload.kind)) throw new Error('طلب غير صالح');
    const product = await findProduct(payload.key, runtime);
    if (!product) throw new Error('الخدمة مو متوفرة');
    if (payload.kind === 'buy' && !canAutoPurchase(product)) throw new Error('الخدمة تحتاج بيانات إضافية');
    if (payload.kind === 'buyi' && (!canPurchaseWithInput(product) || !validCustomerEmail(payload.customerEmail))) throw new Error('بيانات الحساب غير صالحة');
    if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) throw new Error('الخدمة نفدت');
    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== payload.charged || query.total_amount !== payload.charged || query.currency !== 'XTR') throw new Error('السعر تغيّر، افتح الخدمة من جديد');
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: true });
  } catch (error) {
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: `ما قدرنا نكمل الطلب: ${error.message}`.slice(0, 200) });
  }
}

async function deliverPaidOrder(message, runtime) {
  const payment = message.successful_payment;
  const user = message.from;
  const chatId = message.chat.id;
  const payload = parseInvoicePayload(payment.invoice_payload);

  try {
    if (!['buy', 'buyi'].includes(payload.kind)) throw new Error('بيانات الدفع غير صالحة');
    const product = await findProduct(payload.key, runtime);
    if (!product) throw new Error('الخدمة اختفت من المورد');
    if (payload.kind === 'buy' && !canAutoPurchase(product)) throw new Error('الخدمة تحتاج بيانات إضافية');
    if (payload.kind === 'buyi' && (!canPurchaseWithInput(product) || !validCustomerEmail(payload.customerEmail))) throw new Error('بيانات الحساب غير صالحة');
    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== payload.charged || payment.total_amount !== payload.charged || payment.currency !== 'XTR') throw new Error('السعر تغيّر بعد الدفع');

    await sendMessage(chatId, '✅ وصل الدفع، جاري تجهيز طلبك...');
    const inputs = payload.kind === 'buyi' ? { customerEmail: payload.customerEmail } : {};
    const result = await purchaseProduct(product, user, `tg-charge-${payment.telegram_payment_charge_id}`, inputs);
    await sendLongMessage(chatId, `✅ تم طلبك بنجاح.${payload.customerEmail ? `\nالحساب: ${payload.customerEmail}` : ''}\n\n${JSON.stringify(result, null, 2)}`);

    const adminId = cfg.adminId();
    if (adminId) await sendMessage(adminId, `✅ طلب ناجح\nالمستخدم: ${user.id}${user.username ? ` @${user.username}` : ''}\nالمنتج: ${product.name}${payload.customerEmail ? `\nالحساب: ${payload.customerEmail}` : ''}\nالمدفوع: ${payload.charged} ⭐`);
  } catch (error) {
    try {
      await tg('refundStarPayment', { user_id: user.id, telegram_payment_charge_id: payment.telegram_payment_charge_id });
      await sendMessage(chatId, `❌ ما قدرنا ننفذ الطلب، ورجعنا لك ${payment.total_amount} نجمة تلقائياً.`);
    } catch (refundError) {
      await sendMessage(chatId, '⚠️ صار خلل بالتنفيذ والاسترجاع الآلي. رفعنا الحالة للإدارة.');
      const adminId = cfg.adminId();
      if (adminId) await sendLongMessage(adminId, `🚨 فشل طلب + فشل Refund\nUser: ${user.id}\nCharge: ${payment.telegram_payment_charge_id}\nPurchase error: ${error.message}\nRefund error: ${refundError.message}`);
    }
  }
}

async function resetMenuButton() {
  try { await tg('setChatMenuButton', { menu_button: { type: 'default' } }); }
  catch (error) { console.warn('menu_reset_failed', error.message); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== cfg.webhookSecret()) return res.status(401).json({ ok: false });

  try {
    const runtime = await getRuntimeConfig();
    const update = req.body || {};

    if (update.pre_checkout_query) {
      await validateCheckout(update.pre_checkout_query, runtime);
    } else if (update.message?.successful_payment) {
      await deliverPaidOrder(update.message, runtime);
    } else if (update.message) {
      const rawText = String(update.message.text || '').trim();
      const text = rawText.toLowerCase();
      if (await handleAccountReply(update.message, runtime)) {
        // Force-reply purchase flow handled above.
      } else if (text === '/start') {
        await resetMenuButton();
        await showNativeHome(update.message.chat.id, runtime);
      } else if (text === '/products' || text === '🛍 products' || text === 'المنتجات') {
        await showCategories(update.message.chat.id, runtime);
      } else if (text === '/help' || text === '💬 support') {
        await sendMessage(update.message.chat.id, runtime?.helpMessage || 'اختر قسم، افتح المنتج، وإذا ناسبك اضغط شراء ⭐');
      } else if (text === '👛 wallet') {
        await sendMessage(update.message.chat.id, '👛 المحفظة\nالدفع داخل المتجر يتم عن طريق Telegram Stars ⭐');
      } else if (text === '🔗 api') {
        await sendMessage(update.message.chat.id, '🔗 API\nإذا تحتاج API أو ربط خاص، تواصل مع الدعم.');
      } else if (text === '🛡 warranty') {
        await sendMessage(update.message.chat.id, '🛡 الضمان\nكل خدمة يوضح ضمانها داخل تفاصيلها قبل الشراء.');
      } else {
        await showNativeHome(update.message.chat.id, runtime);
      }
    } else if (update.callback_query) {
      const query = update.callback_query;
      await answerCallbackQuery(query.id);
      const data = String(query.data || '');
      if (data === 'cats') await showCategories(query.message.chat.id, runtime);
      else if (data.startsWith('cat:')) await showCategory(query.message.chat.id, data.slice(4), runtime);
      else if (data.startsWith('catp:')) {
        const rest = data.slice(5);
        const i = rest.lastIndexOf(':');
        await showCategory(query.message.chat.id, i < 0 ? rest : rest.slice(0, i), runtime, i < 0 ? 1 : rest.slice(i + 1));
      }
      else if (data.startsWith('p:')) await showProduct(query.message.chat.id, data.slice(2), runtime);
      else if (data.startsWith('buy:')) await startInvoice(query.message.chat.id, query.from, data.slice(4), runtime);
      else if (data.startsWith('form:')) {
        const [, key, total] = data.split(':');
        await startInputFlow(query.message.chat.id, key, total, runtime);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
