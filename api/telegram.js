import { cfg } from './_lib/config.js';
import { tg, sendMessage, sendLongMessage, answerCallbackQuery } from './_lib/telegram.js';
import { fetchProducts, purchaseProduct, canAutoPurchase } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';

let menuConfiguredAt = 0;

function storeUrl() {
  return cfg.publicBaseUrl() || 'https://evert-ingredients.vercel.app';
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

async function findProduct(key, runtime) {
  const products = await visibleProducts(runtime);
  return products.find(product => product.key === key) || null;
}

function storeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🛍 فتح المتجر', web_app: { url: storeUrl() } }],
      [{ text: '💬 الدعم', callback_data: 'help' }],
    ],
  };
}

async function ensureMenuButton() {
  if (Date.now() - menuConfiguredAt < 6 * 60 * 60 * 1000) return;
  try {
    await tg('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '🛍 المتجر',
        web_app: { url: storeUrl() },
      },
    });
    menuConfiguredAt = Date.now();
  } catch (error) {
    console.warn('menu_button_setup_failed', error.message);
  }
}

async function showHome(chatId, runtime) {
  await ensureMenuButton();
  const title = runtime?.storeTitle || 'كل شي';
  const welcome = runtime?.welcomeMessage || `هلا 👋\nهذا متجر ${title}. اختر اللي تبيه وخله علينا.`;
  return sendMessage(chatId, welcome, { reply_markup: storeKeyboard() });
}

async function startInvoice(chatId, user, key, runtime) {
  if (!livePurchases(runtime)) {
    return sendMessage(chatId, 'الشراء مقفل مؤقتاً، تقدر تتصفح المتجر لين يرجع يشتغل.');
  }

  const product = await findProduct(key, runtime);
  if (!product) return sendMessage(chatId, 'الخدمة مو متوفرة حالياً.');
  if (!canAutoPurchase(product)) return sendMessage(chatId, 'هالخدمة تحتاج بيانات إضافية قبل التنفيذ.');
  if (typeof product?.availability?.available === 'number' && product.availability.available <= 0) {
    return sendMessage(chatId, 'الخدمة خلصت حالياً، جرّب غيرها.');
  }

  const stars = priceToStars(product.price, runtime);
  if (!stars) return sendMessage(chatId, 'السعر مو متوفر حالياً.');

  return tg('sendInvoice', {
    chat_id: chatId,
    title: String(product.name || 'خدمة رقمية').slice(0, 32),
    description: 'خدمة رقمية جاهزة من متجرنا — الدفع آمن عن طريق Telegram Stars.',
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
    if (!expected || expected !== charged || query.total_amount !== charged || query.currency !== 'XTR') {
      throw new Error('السعر تغيّر، افتح الخدمة من جديد');
    }

    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: true });
  } catch (error) {
    await tg('answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: `ما قدرنا نكمل الطلب: ${error.message}`.slice(0, 200),
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
    if (kind !== 'buy') throw new Error('بيانات الدفع غير صالحة');
    const product = await findProduct(key, runtime);
    if (!product) throw new Error('الخدمة اختفت من المورد');
    if (!canAutoPurchase(product)) throw new Error('الخدمة تحتاج بيانات إضافية');

    const expected = priceToStars(product.price, runtime);
    if (!expected || expected !== charged || payment.total_amount !== charged || payment.currency !== 'XTR') {
      throw new Error('السعر تغيّر بعد الدفع');
    }

    await sendMessage(chatId, '✅ وصل الدفع، جاري تجهيز طلبك...');
    const result = await purchaseProduct(product, user, `tg-charge-${payment.telegram_payment_charge_id}`);
    await sendLongMessage(chatId, `✅ تم طلبك بنجاح.\n\n${JSON.stringify(result, null, 2)}`);

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
      await sendMessage(chatId, `❌ ما قدرنا ننفذ الطلب، ورجعنا لك ${payment.total_amount} نجمة تلقائياً.`);
    } catch (refundError) {
      await sendMessage(chatId, '⚠️ صار خلل بالتنفيذ والاسترجاع الآلي. رفعنا الحالة للإدارة.');
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
      const rawText = String(update.message.text || '').trim();
      const text = rawText.toLowerCase();
      const buyMatch = rawText.match(/^\/start\s+buy_([a-f0-9]{12})$/i);
      if (buyMatch) await startInvoice(update.message.chat.id, update.message.from, buyMatch[1], runtime);
      else if (text === '/help') await sendMessage(update.message.chat.id, runtime?.helpMessage || 'افتح المتجر، اختر الخدمة، وإذا ناسبتك اضغط شراء ⭐', { reply_markup: storeKeyboard() });
      else await showHome(update.message.chat.id, runtime);
    } else if (update.callback_query) {
      const query = update.callback_query;
      await answerCallbackQuery(query.id);
      const data = String(query.data || '');
      if (data === 'help') await sendMessage(query.message.chat.id, runtime?.helpMessage || 'افتح المتجر، اختر الخدمة، وإذا ناسبتك اضغط شراء ⭐', { reply_markup: storeKeyboard() });
      else if (data.startsWith('buy:')) await startInvoice(query.message.chat.id, query.from, data.slice(4), runtime);
      else await showHome(query.message.chat.id, runtime);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
