import crypto from 'node:crypto';
import { cfg } from './_lib/config.js';
import { tg, sendMessage, sendLongMessage, answerCallbackQuery, categoryButton } from './_lib/telegram.js';
import { fetchProducts, purchaseProduct, canAutoPurchase, canPurchaseWithInput } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';

const CATEGORIES = [
  { slug: 'apple', label: 'Apple', icon: '🍎', re: /apple\s*id|icloud|\bapple\b/i },
  { slug: 'chatgpt', label: 'ChatGPT', icon: '🤖', re: /chatgpt|openai/i },
  { slug: 'google', label: 'Google', icon: '🌈', re: /google one|gemini|google/i },
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
  const markup = runtime?.markupPercent != null && Number.isFinite(Number(runtime.markupPercent)) ? Number(runtime.markupPercent) : cfg.markup();
  return Math.max(1, Math.ceil(price * rate * (1 + markup / 100)));
}

async function visibleProducts({ fresh = false } = {}) {
  return fetchProducts({ fresh });
}

async function findProduct(key, runtime, { fresh = false } = {}) {
  return (await visibleProducts({ fresh })).find(product => product.key === key) || null;
}

function short(value, max = 34) {
  const text = String(value || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!text) return 'منتج';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function supplierPriceFingerprint(product) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([product.price, product.currency || '']))
    .digest('hex')
    .slice(0, 6);
}

function detailText(value) {
  const text = String(value || '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
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
      [{ text: '🛍 المنتجات' }, { text: '💬 الدعم' }],
      [{ text: '👛 المحفظة' }, { text: '🔗 API' }],
      [{ text: '🛡 الضمان' }],
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
    const tier = /\bpro\b/i.test(raw) ? ' Pro' : /\bteam\b/i.test(raw) ? ' Team' : /\bplus\b/i.test(raw) ? ' Plus' : '';
    return withDuration(`GPT${tier}`);
  }
  if (/gmail|google mail/.test(lower)) return withDuration('Gmail');
  if (/youtube/.test(lower)) return withDuration('YouTube');
  if (/apple\s*id/.test(lower)) return /\b2fa\b/i.test(raw) ? 'Apple ID 2FA' : 'Apple ID';
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
  const category = categoryOf(product);
  const emoji = category.slug === 'other' ? productEmoji(product) : category.icon;
  return `${emoji} ${compactProductName(product)}`;
}

async function showCategory(chatId, slug, runtime, page = 1) {
  const products = await visibleProducts(runtime);
  const group = categoryGroups(products).get(slug);
  if (!group || !group.products.length) return sendMessage(chatId, 'حالياً ما فيه منتجات بهالقسم.');

  const configured = runtime?.productsPageSize != null ? Number(runtime.productsPageSize) : cfg.productsPageSize();
  const wanted = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 20) : Math.min(cfg.productsPageSize(), 20);
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
  const [freshRuntime, product] = await Promise.all([
    getRuntimeConfig({ fresh: true }),
    findProduct(key, runtime, { fresh: true }),
  ]);
  if (!livePurchases(freshRuntime)) return sendMessage(chatId, 'الشراء مقفل مؤقتاً، تقدر تتصفح لين يرجع يشتغل.');
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');
  if (!canPurchaseWithInput(product)) return sendMessage(chatId, 'متطلبات هالخدمة ما هي مدعومة تلقائياً حالياً.');
  const count = Math.min(3, Math.max(1, Number(total) || 1));
  if (typeof product?.availability?.available === 'number' && product.availability.available < count) return sendMessage(chatId, '⛔ الكمية المطلوبة مو متوفرة حالياً.');
  return askForAccount(chatId, key, count, 1, []);
}

function inputInvoicePayload(key, stars, fingerprint, email) {
  const payload = `buyi:${key}:${stars}:${fingerprint}:${encodeURIComponent(email)}`;
  return Buffer.byteLength(payload, 'utf8') <= 128 ? payload : null;
}

async function sendInputInvoice(chatId, key, freshRuntime, product, email, index, total) {
  if (!product || !canPurchaseWithInput(product)) return sendMessage(chatId, `❌ تعذر تجهيز فاتورة الحساب ${index}.`);
  if (!livePurchases(freshRuntime) || (typeof product?.availability?.available === 'number' && product.availability.available <= 0)) return sendMessage(chatId, `⛔ الحساب ${index} غير متوفر حالياً.`);
  const stars = priceToStars(product.price, freshRuntime);
  if (!stars) return sendMessage(chatId, `❌ السعر غير متوفر للحساب ${index}.`);
  const payload = inputInvoicePayload(product.key, stars, supplierPriceFingerprint(product), email);
  if (!payload) return sendMessage(chatId, `❌ بريد الحساب ${index} طويل أكثر من الحد المدعوم.`);

  return tg('sendInvoice', {
    chat_id: chatId,
    title: short(product.name, 32),
    description: `الحساب ${index}/${total}`,
    payload,
    currency: 'XTR',
    prices: [{ label: `الحساب ${index}`, amount: stars }],
  });
}

async function handleAccountReply(message, runtime) {
  if (!privatePurchaseChat(message.chat?.id, message.from?.id, message.chat?.type)) return false;
  const origin = message.reply_to_message?.from;
  const expectedBotId = cfg.telegramToken().split(':', 1)[0];
  if (!origin?.is_bot || String(origin.id) !== expectedBotId) return false;
  const state = parseAccountPrompt(message.reply_to_message?.text);
  if (!state) return false;
  if (state.index > state.total || state.accounts.length !== state.index - 1 || state.accounts.some(value => !validCustomerEmail(value))) return false;

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

  const [freshRuntime, product] = await Promise.all([
    getRuntimeConfig({ fresh: true }),
    findProduct(state.key, runtime, { fresh: true }),
  ]);
  if (!product || !livePurchases(freshRuntime) || !canPurchaseWithInput(product) || (typeof product?.availability?.available === 'number' && product.availability.available < accounts.length)) {
    await sendMessage(message.chat.id, '⛔ الحسابات المطلوبة مو متوفرة حالياً. افتح المنتج من جديد.');
    return true;
  }

  for (let i = 0; i < accounts.length; i += 1) {
    await sendInputInvoice(message.chat.id, state.key, freshRuntime, product, accounts[i], i + 1, accounts.length);
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
    `${category.icon} ${String(product.name || 'منتج')}`,
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

  const text = lines.join('\n');
  if (text.length <= 3800) return sendMessage(chatId, text, { reply_markup: keyboard });
  await sendLongMessage(chatId, text);
  return sendMessage(chatId, 'اختر الإجراء:', { reply_markup: keyboard });
}

async function startInvoice(chatId, user, key, runtime) {
  const [freshRuntime, product] = await Promise.all([
    getRuntimeConfig({ fresh: true }),
    findProduct(key, runtime, { fresh: true }),
  ]);
  if (!livePurchases(freshRuntime)) return sendMessage(chatId, 'الشراء مقفل مؤقتاً، تقدر تتصفح لين يرجع يشتغل.');
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');
  if (!canAutoPurchase(product)) return sendMessage(chatId, 'هالخدمة تحتاج بيانات إضافية قبل التنفيذ.');
  if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) return sendMessage(chatId, '⛔ غير متوفر حالياً');
  const stars = priceToStars(product.price, freshRuntime);
  if (!stars) return sendMessage(chatId, 'السعر مو متوفر حالياً.');

  return tg('sendInvoice', {
    chat_id: chatId,
    title: short(product.name, 32),
    description: 'خدمة رقمية جاهزة — الدفع آمن عن طريق Telegram Stars.',
    payload: `buy:${product.key}:${stars}:${supplierPriceFingerprint(product)}`,
    currency: 'XTR',
    prices: [{ label: 'الخدمة', amount: stars }],
  });
}

function privatePurchaseChat(chatId, userId, chatType) {
  return chatType === 'private' && String(chatId) === String(userId);
}

function parseInvoicePayload(payload) {
  const parts = String(payload || '').split(':');
  const kind = parts[0];
  const key = parts[1] || '';
  const charged = Number(parts[2]);
  let customerEmail = '';
  let priceFingerprint = '';
  if (kind === 'buyi' && parts[4]) {
    priceFingerprint = parts[3];
    try { customerEmail = decodeURIComponent(parts.slice(4).join(':')); } catch { customerEmail = ''; }
  } else if (kind === 'buyi' && parts[3]) {
    try { customerEmail = decodeURIComponent(parts.slice(3).join(':')); } catch { customerEmail = ''; }
  } else if (kind === 'buy' && parts[3]) {
    priceFingerprint = parts[3];
  }
  return { kind, key, charged, customerEmail, priceFingerprint };
}

async function validateCheckout(query) {
  let payload;
  try {
    payload = parseInvoicePayload(query.invoice_payload);
    if (!['buy', 'buyi'].includes(payload.kind)) throw new Error('invalid');
    if (!Number.isInteger(payload.charged) || payload.charged < 1 || query.total_amount !== payload.charged || query.currency !== 'XTR') throw new Error('invalid');
    const [runtime, product] = await Promise.all([
      getRuntimeConfig({ fresh: true }),
      findProduct(payload.key, null, { fresh: true }),
    ]);
    if (!livePurchases(runtime)) throw new Error('closed');
    if (!product) throw new Error('changed');
    if (payload.kind === 'buy' && !canAutoPurchase(product)) throw new Error('changed');
    if (payload.kind === 'buyi' && (!canPurchaseWithInput(product) || !validCustomerEmail(payload.customerEmail))) throw new Error('changed');
    if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) throw new Error('changed');
    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== payload.charged || query.total_amount !== payload.charged || query.currency !== 'XTR' || (payload.priceFingerprint && payload.priceFingerprint !== supplierPriceFingerprint(product))) throw new Error('changed');
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: true }, { timeoutMs: 2000 });
  } catch (error) {
    const invalid = error.message === 'invalid';
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: invalid ? 'بيانات الفاتورة غير صالحة.' : 'السعر أو التوفر تغيّر. افتح المنتج من جديد.' }, { timeoutMs: 2000 });
  }
}

const paidCharges = new Map();

function paymentIdempotencyKey(chargeId) {
  const candidate = `tg-charge-${chargeId}`;
  return Buffer.byteLength(candidate, 'utf8') <= 128
    ? candidate
    : `tg-charge-${crypto.createHash('sha256').update(String(chargeId)).digest('hex')}`;
}

function safeErrorSummary(error) {
  if (Number.isInteger(error?.status) && error.status > 0) {
    const code = typeof error?.code === 'string' && /^[a-z_]{1,48}$/i.test(error.code)
      ? error.code
      : Number.isInteger(error?.code) && error.code > 0 ? String(error.code) : '';
    return `HTTP ${error.status}${code ? ` / ${code}` : ''}`;
  }
  return error?.name || 'Error';
}

function formatSupplierDelivery(result) {
  const lines = [];
  const order = result?.order;
  if (order && typeof order === 'object') {
    const label = order.productName || order.product_name || 'الطلب';
    lines.push(`📦 ${label}`);
    for (const key of ['orderCode', 'status', 'quantity', 'finalQuantity', 'slotMonths', 'fulfillmentStatus']) {
      const value = order[key];
      if (value != null && value !== '') lines.push(`${key}: ${String(value)}`);
    }
  }
  const delivery = result?.delivery;
  const walk = (value, path = []) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, [...path, String(index + 1)]);
    } else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:api.?key|buyer.?key|token|balance)$/i.test(key)) continue;
        walk(child, [...path, key]);
      }
    } else if (String(value).trim()) {
      const key = path.join(' › ').replace(/[_-]+/g, ' ');
      lines.push(`${key ? `${key}: ` : ''}${String(value)}`);
    }
  };
  walk(delivery);
  if (lines.length <= (order ? 1 : 0)) {
    const sanitize = value => {
      if (Array.isArray(value)) return value.map(sanitize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/^(?:api.?key|buyer.?key|token|balance|payment|key)$/i.test(key))
        .map(([key, child]) => [key, sanitize(child)]));
    };
    const safe = sanitize(result);
    lines.push(JSON.stringify(safe, null, 2));
  }
  return lines.join('\n');
}

async function notifyPaidSuccess(record, message, payment, payload) {
  const chatId = message.chat.id;
  const product = record.product;
  const result = record.result;
  const customerEmail = payload.customerEmail;
  const content = `✅ تم طلبك بنجاح${customerEmail ? `\nالحساب: ${customerEmail}` : ''}\n\n${formatSupplierDelivery(result)}`;
  if (!record.customerNotified) {
    try {
      await sendLongMessage(chatId, content);
      record.customerNotified = true;
    } catch (error) {
      console.warn('customer_delivery_message_failed', error?.name || 'Error');
      return false;
    }
  }
  const adminId = cfg.adminId();
  if (adminId && !record.adminNotified) {
    try {
      await sendMessage(adminId, `✅ طلب ناجح\nالمستخدم: ${message.from.id}\nالمنتج: ${short(product.name, 80)}\nالمدفوع: ${payment.total_amount} ⭐`);
      record.adminNotified = true;
    } catch (error) {
      console.warn('admin_order_notice_failed', error?.name || 'Error');
    }
  }
  return record.customerNotified === true;
}

async function alertForReconciliation(record, message, payment, productName, reason) {
  const adminId = cfg.adminId();
  record.reconciliationNotice ||= { admin: false, customer: false };
  if (adminId && !record.reconciliationNotice.admin) {
    try {
      await sendMessage(adminId, `🚨 طلب يحتاج مراجعة\nالمستخدم: ${message.from.id}\nCharge: ${payment.telegram_payment_charge_id}\nالمنتج: ${short(productName || 'غير معروف', 80)}\nالسبب: ${reason}`);
      record.reconciliationNotice.admin = true;
    } catch (error) {
      console.warn('admin_reconciliation_alert_failed', error?.name || 'Error');
    }
  }
  if (!record.reconciliationNotice.customer) {
    try {
      await sendMessage(message.chat.id, 'وصل دفعك، والطلب يحتاج مراجعة. بنراجع الحالة ونتواصل معك.');
      record.reconciliationNotice.customer = true;
    } catch (error) { console.warn('customer_reconciliation_notice_failed', error?.name || 'Error'); }
  }
  return Boolean(adminId && record.reconciliationNotice.admin && record.reconciliationNotice.customer);
}

async function sendRefundNotices(record) {
  const notice = record.refundNotice;
  if (!notice) return true;
  if (notice.mode === 'refunded') {
    if (!notice.customer) {
      try {
        await sendMessage(notice.message.chat.id, `❌ ما قدرنا ننفذ الطلب، ورجعنا لك ${notice.payment.total_amount} نجمة تلقائياً.`);
        notice.customer = true;
      } catch (error) { console.warn('refund_customer_notice_failed', error?.name || 'Error'); }
    }
    return notice.customer;
  }

  if (!notice.customer) {
    try {
      await sendMessage(notice.message.chat.id, '⚠️ تعذر تنفيذ الطلب والاسترجاع الآلي. رفعنا الحالة للإدارة.');
      notice.customer = true;
    } catch (error) { console.warn('refund_failure_customer_notice_failed', error?.name || 'Error'); }
  }
  const adminId = cfg.adminId();
  if (adminId && !notice.admin) {
    try {
      await sendMessage(adminId, `🚨 فشل الطلب والاسترجاع\nالمستخدم: ${notice.message.from.id}\nCharge: ${notice.payment.telegram_payment_charge_id}\nالمنتج: ${short(notice.productName || 'غير معروف', 80)}\nخطأ التنفيذ: ${notice.reason}\nخطأ الاسترجاع: ${notice.refundError}`);
      notice.admin = true;
    } catch (error) { console.warn('admin_refund_alert_failed', error?.name || 'Error'); }
  }
  return Boolean(adminId && notice.admin && notice.customer);
}

async function refundDefinitiveFailure(record, message, payment, productName, reason) {
  try {
    await tg('refundStarPayment', { user_id: message.from.id, telegram_payment_charge_id: payment.telegram_payment_charge_id });
    record.status = 'refunded';
    record.refundNotice = { mode: 'refunded', message, payment, customer: false };
  } catch (refundError) {
    record.status = 'reconciled';
    record.refundNotice = { mode: 'failed', message, payment, productName, reason, refundError: safeErrorSummary(refundError), customer: false, admin: false };
  }
  const sent = await sendRefundNotices(record);
  if (!sent) throw new Error('refund_notice_retry');
  return record.status === 'refunded';
}

async function flagForReview(record, message, payment, productName, reason) {
  record.status = 'reconciled';
  record.review = { message, payment, productName, reason };
  const sent = await alertForReconciliation(record, message, payment, productName, reason);
  if (!sent) throw new Error('reconciliation_notice_retry');
}

async function processPaidOrder(record, message) {
  const payment = message.successful_payment;
  const payload = parseInvoicePayload(payment.invoice_payload);
  const chargeId = String(payment.telegram_payment_charge_id || '');
  const productName = 'غير معروف';
  const fixedReason = 'invalid_paid_invoice';
  if (!chargeId || !privatePurchaseChat(message.chat?.id, message.from?.id, message.chat?.type) || !['buy', 'buyi'].includes(payload.kind) || !Number.isInteger(payload.charged) || payload.charged < 1 || payment.total_amount !== payload.charged || payment.currency !== 'XTR') {
    record.reason = fixedReason;
    await refundDefinitiveFailure(record, message, payment, productName, fixedReason);
    return;
  }

  let product;
  let freshRuntime;
  try {
    [freshRuntime, product] = await Promise.all([
      getRuntimeConfig({ fresh: true }),
      findProduct(payload.key, null, { fresh: true }),
    ]);
  } catch {
    return flagForReview(record, message, payment, productName, 'fresh_supplier_validation_failed');
  }
  if (!product || (payload.kind === 'buy' && !canAutoPurchase(product)) || (payload.kind === 'buyi' && (!canPurchaseWithInput(product) || !validCustomerEmail(payload.customerEmail))) || (typeof product?.availability?.available === 'number' && product.availability.available <= 0) || priceToStars(product.price, freshRuntime) !== payload.charged || (payload.priceFingerprint && payload.priceFingerprint !== supplierPriceFingerprint(product))) {
    return flagForReview(record, message, payment, product?.name || productName, 'paid_order_current_product_changed');
  }

  record.product = product;
  const inputs = payload.kind === 'buyi' ? { customerEmail: payload.customerEmail } : {};
  let result;
  try {
    result = await purchaseProduct(product, message.from, paymentIdempotencyKey(chargeId), inputs);
    if (result?.success === false) {
      const error = new Error('supplier_rejected');
      error.definitive = true;
      throw error;
    }
  } catch (error) {
    const reason = error?.status ? `${error?.code || 'supplier_error'}_${error.status}` : (error?.code || 'supplier_purchase_failed');
    if (error?.definitive) {
      record.reason = reason;
      await refundDefinitiveFailure(record, message, payment, product.name, reason);
      return;
    }
    return flagForReview(record, message, payment, product.name, `supplier_outcome_ambiguous${error?.status ? `_http_${error.status}` : ''}`);
  }

  record.status = 'fulfilled';
  record.result = result;
  const notified = await notifyPaidSuccess(record, message, payment, payload);
  if (!notified) throw new Error('post_payment_delivery_retry');
}

async function deliverPaidOrder(message) {
  const payment = message.successful_payment;
  const chargeId = String(payment.telegram_payment_charge_id || '');
  let record = chargeId ? paidCharges.get(chargeId) : null;
  if (record?.promise) return record.promise;
  if (record) {
    let retry;
    if (record.status === 'fulfilled') {
      retry = async () => {
        const notified = await notifyPaidSuccess(record, message, payment, parseInvoicePayload(payment.invoice_payload));
        if (!notified) throw new Error('post_payment_delivery_retry');
      };
    } else if (record.refundNotice) {
      retry = async () => {
        if (!await sendRefundNotices(record)) throw new Error('refund_notice_retry');
      };
    } else if (record.review) {
      retry = async () => {
        const { message: original, payment: originalPayment, productName, reason } = record.review;
        if (!await alertForReconciliation(record, original, originalPayment, productName, reason)) throw new Error('reconciliation_notice_retry');
      };
    }
    if (!retry) return;
    record.promise = retry();
    try { await record.promise; }
    finally { record.promise = null; }
    return;
  }
  record = { status: 'processing', promise: null };
  if (chargeId) paidCharges.set(chargeId, record);
  record.promise = processPaidOrder(record, message);
  try { await record.promise; }
  finally {
    record.promise = null;
    if (paidCharges.size > 250) paidCharges.delete(paidCharges.keys().next().value);
  }
}

async function resetMenuButton() {
  try { await tg('setChatMenuButton', { menu_button: { type: 'default' } }); }
  catch (error) { console.warn('menu_reset_failed', error?.name || 'Error'); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== cfg.webhookSecret()) return res.status(401).json({ ok: false });

  try {
    const update = req.body || {};

    if (update.pre_checkout_query) {
      await validateCheckout(update.pre_checkout_query);
    } else if (update.message?.successful_payment) {
      await deliverPaidOrder(update.message);
    } else {
      const runtime = await getRuntimeConfig();
      if (update.message) {
      const rawText = String(update.message.text || '').trim();
      const text = rawText.toLowerCase();
      if (await handleAccountReply(update.message, runtime)) {
        // Force-reply purchase flow handled above.
      } else if (text === '/start') {
        await resetMenuButton();
        await showNativeHome(update.message.chat.id, runtime);
      } else if (text === '/products' || text === '🛍 products' || text === 'products' || text === '🛍 المنتجات' || text === 'المنتجات') {
        await showCategories(update.message.chat.id, runtime);
      } else if (text === '/help' || text === '💬 support' || text === 'support' || text === '💬 الدعم' || text === 'الدعم') {
        await sendMessage(update.message.chat.id, runtime?.helpMessage || 'اختر قسم، افتح المنتج، وإذا ناسبك اضغط شراء ⭐');
      } else if (text === '👛 wallet' || text === 'wallet' || text === '👛 المحفظة' || text === 'المحفظة') {
        await sendMessage(update.message.chat.id, '👛 المحفظة\nالدفع داخل المتجر يتم عن طريق Telegram Stars ⭐');
      } else if (text === '🔗 api') {
        await sendMessage(update.message.chat.id, '🔗 API\nإذا تحتاج API أو ربط خاص، تواصل مع الدعم.');
      } else if (text === '🛡 warranty' || text === 'warranty' || text === '🛡 الضمان' || text === 'الضمان') {
        await sendMessage(update.message.chat.id, '🛡 الضمان\nكل خدمة يوضح ضمانها داخل تفاصيلها قبل الشراء.');
      } else {
        await showNativeHome(update.message.chat.id, runtime);
      }
      } else if (update.callback_query) {
        const query = update.callback_query;
        const data = String(query.data || '');
        if ((data.startsWith('buy:') || data.startsWith('form:')) && !privatePurchaseChat(query.message?.chat?.id, query.from?.id, query.message?.chat?.type)) {
          await answerCallbackQuery(query.id, 'الشراء متاح من المحادثة الخاصة مع البوت.');
        } else {
          await answerCallbackQuery(query.id);
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
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('telegram_webhook_error', safeErrorSummary(error));
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
