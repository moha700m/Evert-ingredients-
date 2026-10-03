import { cfg, env } from './_lib/config.js';
import { tg, sendMessage, sendLongMessage, answerCallbackQuery } from './_lib/telegram.js';
import { fetchProducts, arabizeProduct, purchaseProduct, canAutoPurchase } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';

const mainKeyboard = {
  inline_keyboard: [
    [{ text: '🛍 المنتجات', callback_data: 'products:0' }],
    [{ text: 'ℹ️ المساعدة', callback_data: 'help' }],
  ],
};

function pageSize(runtime) {
  const remote = Number(runtime?.productsPageSize);
  if (Number.isInteger(remote) && remote >= 4 && remote <= 10) return remote;
  const fallback = Number(env('PRODUCTS_PAGE_SIZE', '8'));
  return Number.isInteger(fallback) && fallback >= 4 && fallback <= 10 ? fallback : 8;
}

function compactDescription(value, max = 220) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'وصف مختصر غير متوفر.';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.7 ? lastSpace : max).trim()}…`;
}

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

async function showHome(chatId, runtime) {
  const welcome = runtime?.welcomeMessage || 'أهلًا بك 👋\n\nمتجر خدمات رقمية بواجهة عربية. اختر من القائمة:';
  const title = runtime?.storeTitle ? `🏪 ${runtime.storeTitle}\n\n` : '';
  return sendMessage(chatId, `${title}${welcome}`, { reply_markup: mainKeyboard });
}

async function showProducts(chatId, runtime, requestedPage = 0) {
  const products = await visibleProducts(runtime);
  if (!products.length) return sendMessage(chatId, 'لا توجد منتجات متاحة حاليًا.');

  const size = pageSize(runtime);
  const pageCount = Math.max(1, Math.ceil(products.length / size));
  const page = Math.min(Math.max(Number(requestedPage) || 0, 0), pageCount - 1);
  const subset = products.slice(page * size, page * size + size);
  const localized = await Promise.all(subset.map(arabizeProduct));

  const rows = localized.map(ar => {
    const stars = priceToStars(ar.price, runtime);
    const suffix = stars ? ` — ⭐ ${stars}` : '';
    return [{ text: `${ar.nameAr.slice(0, 42)}${suffix}`, callback_data: `p:${ar.key}` }];
  });

  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ السابق', callback_data: `products:${page - 1}` });
  nav.push({ text: `${page + 1}/${pageCount}`, callback_data: 'noop' });
  if (page < pageCount - 1) nav.push({ text: 'التالي ➡️', callback_data: `products:${page + 1}` });
  rows.push(nav);
  rows.push([{ text: '🏠 الرئيسية', callback_data: 'home' }]);

  return sendMessage(
    chatId,
    `🛍 المنتجات المتاحة (${products.length})\nالصفحة ${page + 1} من ${pageCount}\nاختر منتجًا:`,
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function findProduct(key, runtime) {
  const products = await visibleProducts(runtime);
  return products.find(product => product.key === key) || null;
}

function availabilityLine(product) {
  const available = product?.availability?.available;
  if (typeof available !== 'number') return '';
  return available > 0 ? `\n📦 المتاح: ${available}` : '\n⛔ غير متوفر حاليًا';
}

async function showProduct(chatId, key, runtime) {
  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'المنتج لم يعد متاحًا. حدّث قائمة المنتجات.');

  const ar = await arabizeProduct(product);
  const stars = priceToStars(product.price, runtime);
  const priceLine = stars ? `⭐ السعر: ${stars} نجمة` : 'السعر غير متاح حاليًا';
  const needsInput = !canAutoPurchase(product);
  const specialLine = needsInput ? '\n⚠️ يحتاج بيانات إضافية قبل التنفيذ.' : '';
  const text = `📦 ${ar.nameAr}\n\n${compactDescription(ar.descAr)}\n\n${priceLine}${availabilityLine(product)}${specialLine}`;
  const keyboard = { inline_keyboard: [] };

  const available = product?.availability?.available;
  const inStock = typeof available !== 'number' || available > 0;
  if (stars && inStock && !needsInput) {
    keyboard.inline_keyboard.push([{ text: '⭐ شراء الآن', callback_data: `buy:${product.key}` }]);
  }
  keyboard.inline_keyboard.push([{ text: '↩️ المنتجات', callback_data: 'products:0' }]);
  return sendMessage(chatId, text, { reply_markup: keyboard });
}

async function startInvoice(chatId, user, key, runtime) {
  if (!livePurchases(runtime)) {
    return sendMessage(chatId, '🧪 الشراء الحقيقي متوقف حاليًا من لوحة التحكم.');
  }

  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'هذا المنتج لم يعد متاحًا.');
  if (!canAutoPurchase(product)) return sendMessage(chatId, 'هذا المنتج يحتاج بيانات إضافية قبل الشراء ولا يدعم التنفيذ الآلي حاليًا.');
  if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) {
    return sendMessage(chatId, 'هذا المنتج غير متوفر حاليًا.');
  }

  const ar = await arabizeProduct(product);
  const stars = priceToStars(product.price, runtime);
  if (!stars) return sendMessage(chatId, 'تعذر تحديد سعر هذا المنتج.');

  return tg('sendInvoice', {
    chat_id: chatId,
    title: ar.nameAr.slice(0, 32) || 'منتج رقمي',
    description: compactDescription(ar.descAr || 'خدمة رقمية', 180),
    payload: `buy:${product.key}:${stars}`,
    currency: 'XTR',
    prices: [{ label: ar.nameAr.slice(0, 32) || 'المنتج', amount: stars }],
  });
}

async function validateCheckout(query, runtime) {
  try {
    const [kind, key, chargedRaw] = String(query.invoice_payload || '').split(':');
    if (kind !== 'buy') throw new Error('طلب غير صالح');

    const product = await findProduct(key, runtime);
    if (!product) throw new Error('المنتج لم يعد متاحًا');
    if (!canAutoPurchase(product)) throw new Error('هذا المنتج يحتاج بيانات إضافية');
    if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) throw new Error('المنتج نفد من المخزون');

    const expected = priceToStars(product.price, runtime);
    const charged = Number(chargedRaw);
    if (!expected || expected !== charged || query.total_amount !== charged || query.currency !== 'XTR') {
      throw new Error('تغير السعر. أعد فتح المنتج وحاول من جديد');
    }

    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: true });
  } catch (error) {
    await tg('answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: `تعذر إكمال الطلب: ${error.message}`.slice(0, 200),
    });
  }
}

async function deliverPaidOrder(message, runtime) {
  const payment = message.successful_payment;
  const user = message.from;
  const chatId = message.chat.id;
  const [kind, key, chargedRaw] = String(payment.invoice_payload || '').split(':');
  const charged = Number(chargedRaw);

  try {
    if (kind !== 'buy') throw new Error('حمولة الدفع غير صالحة');
    const product = await findProduct(key, runtime);
    if (!product) throw new Error('المنتج اختفى من المورد');
    if (!canAutoPurchase(product)) throw new Error('المنتج يحتاج بيانات إضافية');

    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== charged || payment.total_amount !== charged || payment.currency !== 'XTR') {
      throw new Error('السعر تغيّر بعد الدفع');
    }

    await sendMessage(chatId, '✅ تم استلام الدفع. جاري تنفيذ طلبك الآن...');
    const result = await purchaseProduct(product, user, `tg-charge-${payment.telegram_payment_charge_id}`);
    await sendLongMessage(chatId, `✅ تم تنفيذ الطلب بنجاح.\n\n${JSON.stringify(result, null, 2)}`);

    const adminId = cfg.adminId();
    if (adminId) {
      await sendMessage(adminId, `✅ طلب ناجح\nالمستخدم: ${user.id}${user.username ? ` @${user.username}` : ''}\nالمنتج: ${product.name}\nالمدفوع: ${charged} ⭐`);
    }
  } catch (error) {
    try {
      await tg('refundStarPayment', {
        user_id: user.id,
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
      });
      await sendMessage(chatId, `❌ تعذر تنفيذ الطلب لدى المورد، وتمت إعادة ${payment.total_amount} نجمة لك تلقائيًا.\n\nالسبب: ${error.message}`);
    } catch (refundError) {
      await sendMessage(chatId, '⚠️ تعذر تنفيذ الطلب وتعذر الرد الآلي للمبلغ. تم إرسال الحالة للإدارة لمراجعتها فورًا.');
      const adminId = cfg.adminId();
      if (adminId) {
        await sendLongMessage(adminId, `🚨 فشل طلب + فشل Refund\nUser: ${user.id}\nCharge: ${payment.telegram_payment_charge_id}\nPurchase error: ${error.message}\nRefund error: ${refundError.message}`);
      }
    }
  }
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
      const text = String(update.message.text || '').trim().toLowerCase();
      if (text === '/products' || text === 'المنتجات') await showProducts(update.message.chat.id, runtime, 0);
      else if (text === '/help') await sendMessage(update.message.chat.id, runtime?.helpMessage || 'استخدم /products لعرض المنتجات. الأسعار المعروضة بالنجوم تشمل هامش المتجر المحدد من الإدارة.');
      else await showHome(update.message.chat.id, runtime);
    } else if (update.callback_query) {
      const query = update.callback_query;
      await answerCallbackQuery(query.id);
      const data = String(query.data || '');
      if (data === 'noop') return res.status(200).json({ ok: true });
      if (data === 'home') await showHome(query.message.chat.id, runtime);
      else if (data === 'products') await showProducts(query.message.chat.id, runtime, 0);
      else if (data.startsWith('products:')) await showProducts(query.message.chat.id, runtime, data.split(':')[1]);
      else if (data === 'help') await sendMessage(query.message.chat.id, runtime?.helpMessage || 'اختر المنتجات، افتح المنتج، ثم اشترِ باستخدام Telegram Stars.');
      else if (data.startsWith('p:')) await showProduct(query.message.chat.id, data.slice(2), runtime);
      else if (data.startsWith('buy:')) await startInvoice(query.message.chat.id, query.from, data.slice(4), runtime);
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
