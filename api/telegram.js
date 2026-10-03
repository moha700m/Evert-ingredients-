import { cfg } from './_lib/config.js';
import { tg, sendMessage, sendLongMessage, answerCallbackQuery } from './_lib/telegram.js';
import { fetchProducts, purchaseProduct, canAutoPurchase } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';

const CATEGORIES = [
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
  const markup = Number.isFinite(Number(runtime?.markupPercent)) ? Number(runtime.markupPercent) : cfg.markup();
  return Math.max(1, Math.ceil(price * rate * (1 + markup / 100)));
}

function hiddenIds(runtime) {
  return new Set(Array.isArray(runtime?.hiddenProductIds) ? runtime.hiddenProductIds.map(String) : []);
}

async function visibleProducts(runtime) {
  const hidden = hiddenIds(runtime);
  return (await fetchProducts()).filter(product => !hidden.has(String(product.id)));
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

  const buttons = ordered.map(group => ({
    text: `${group.category.icon} ${group.category.label}`,
    callback_data: `cat:${group.category.slug}`,
  }));

  return sendMessage(chatId, 'اختر الخدمة اللي تبيها 👇', {
    reply_markup: { inline_keyboard: chunk(buttons, 3) },
  });
}

async function showCategory(chatId, slug, runtime) {
  const products = await visibleProducts(runtime);
  const group = categoryGroups(products).get(slug);
  if (!group || !group.products.length) return sendMessage(chatId, 'حالياً ما فيه منتجات بهالقسم.');

  const rows = group.products.slice(0, 40).map(product => {
    const stars = priceToStars(product.price, runtime);
    const suffix = stars ? ` — ⭐ ${stars}` : '';
    return [{ text: `${short(product.name, 36)}${suffix}`, callback_data: `p:${product.key}` }];
  });
  rows.push([{ text: '⬅️ رجوع للأقسام', callback_data: 'cats' }]);

  return sendMessage(chatId, `${group.category.icon} ${group.category.label}\nاختر المنتج:`, {
    reply_markup: { inline_keyboard: rows },
  });
}

async function showProduct(chatId, key, runtime) {
  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');

  const stars = priceToStars(product.price, runtime);
  const available = product?.availability?.available;
  const inStock = typeof available !== 'number' || available > 0;
  const auto = canAutoPurchase(product);
  const category = categoryOf(product);

  const lines = [
    `${category.icon} ${short(product.name, 70)}`,
    '',
    'جاهز وسريع، مناسب للي يبي الخدمة بدون تعقيد.',
    '',
    stars ? `⭐ السعر: ${stars} نجمة` : '⭐ السعر: غير متوفر',
  ];
  if (typeof available === 'number') lines.push(available > 0 ? `📦 المتاح: ${available}` : '⛔ غير متوفر حالياً');
  if (!auto) lines.push('⚠️ يحتاج بيانات إضافية قبل التنفيذ.');

  const keyboard = { inline_keyboard: [] };
  if (stars && inStock && auto) keyboard.inline_keyboard.push([{ text: '⭐ شراء الآن', callback_data: `buy:${product.key}` }]);
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

async function validateCheckout(query, runtime) {
  try {
    const [kind, key, chargedRaw] = String(query.invoice_payload || '').split(':');
    if (kind !== 'buy') throw new Error('طلب غير صالح');
    const product = await findProduct(key, runtime);
    if (!product) throw new Error('الخدمة مو متوفرة');
    if (!canAutoPurchase(product)) throw new Error('الخدمة تحتاج بيانات إضافية');
    if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) throw new Error('الخدمة نفدت');
    const expected = priceToStars(product.price, runtime);
    const charged = Number(chargedRaw);
    if (!expected || expected !== charged || query.total_amount !== charged || query.currency !== 'XTR') throw new Error('السعر تغيّر، افتح الخدمة من جديد');
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: true });
  } catch (error) {
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: `ما قدرنا نكمل الطلب: ${error.message}`.slice(0, 200) });
  }
}

async function deliverPaidOrder(message, runtime) {
  const payment = message.successful_payment;
  const user = message.from;
  const chatId = message.chat.id;
  const [kind, key, chargedRaw] = String(payment.invoice_payload || '').split(':');
  const charged = Number(chargedRaw);

  try {
    if (kind !== 'buy') throw new Error('بيانات الدفع غير صالحة');
    const product = await findProduct(key, runtime);
    if (!product) throw new Error('الخدمة اختفت من المورد');
    if (!canAutoPurchase(product)) throw new Error('الخدمة تحتاج بيانات إضافية');
    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== charged || payment.total_amount !== charged || payment.currency !== 'XTR') throw new Error('السعر تغيّر بعد الدفع');

    await sendMessage(chatId, '✅ وصل الدفع، جاري تجهيز طلبك...');
    const result = await purchaseProduct(product, user, `tg-charge-${payment.telegram_payment_charge_id}`);
    await sendLongMessage(chatId, `✅ تم طلبك بنجاح.\n\n${JSON.stringify(result, null, 2)}`);

    const adminId = cfg.adminId();
    if (adminId) await sendMessage(adminId, `✅ طلب ناجح\nالمستخدم: ${user.id}${user.username ? ` @${user.username}` : ''}\nالمنتج: ${product.name}\nالمدفوع: ${charged} ⭐`);
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
      if (text === '/start') {
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
      else if (data.startsWith('p:')) await showProduct(query.message.chat.id, data.slice(2), runtime);
      else if (data.startsWith('buy:')) await startInvoice(query.message.chat.id, query.from, data.slice(4), runtime);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
