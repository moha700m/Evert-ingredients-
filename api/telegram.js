import { cfg } from "./_lib/config.js";
import { tg, sendMessage, sendLongMessage, answerCallbackQuery } from "./_lib/telegram.js";
import { fetchProducts, arabizeProduct, priceToStars, purchaseProduct } from "./_lib/products.js";

const mainKeyboard = {
  inline_keyboard: [
    [{ text: "🛍 المنتجات", callback_data: "products" }],
    [{ text: "ℹ️ المساعدة", callback_data: "help" }]
  ]
};

async function showHome(chatId) {
  return sendMessage(chatId,
    "أهلًا بك 👋\n\nمتجر خدمات رقمية بواجهة عربية. اختر من القائمة:",
    { reply_markup: mainKeyboard }
  );
}

async function showProducts(chatId) {
  const products = await fetchProducts();
  if (!products.length) return sendMessage(chatId, "لا توجد منتجات متاحة حاليًا.");

  const subset = products.slice(0, 20);
  const localized = await Promise.all(subset.map(arabizeProduct));
  const rows = localized.map((ar) => {
    const stars = priceToStars(ar.price);
    const suffix = stars ? ` — ⭐ ${stars}` : "";
    return [{ text: `${ar.nameAr.slice(0, 42)}${suffix}`, callback_data: `p:${ar.key}` }];
  });
  rows.push([{ text: "🏠 الرئيسية", callback_data: "home" }]);
  await sendMessage(chatId, `🛍 المنتجات المتاحة (${products.length})\nاختر منتجًا:`, { reply_markup: { inline_keyboard: rows } });
}

async function findProduct(key) {
  const products = await fetchProducts();
  return products.find(p => p.key === key) || null;
}

async function showProduct(chatId, key) {
  const p = await findProduct(key);
  if (!p) return sendMessage(chatId, "المنتج لم يعد متاحًا. حدّث قائمة المنتجات.");
  const ar = await arabizeProduct(p);
  const stars = priceToStars(p.price);
  const priceLine = stars ? `⭐ السعر: ${stars} نجمة` : "السعر غير متاح حاليًا";
  const text = `📦 ${ar.nameAr}\n\n${ar.descAr || "لا يوجد وصف."}\n\n${priceLine}`;
  const keyboard = { inline_keyboard: [] };
  if (stars) keyboard.inline_keyboard.push([{ text: "⭐ شراء الآن", callback_data: `buy:${p.key}` }]);
  keyboard.inline_keyboard.push([{ text: "↩️ المنتجات", callback_data: "products" }]);
  return sendMessage(chatId, text, { reply_markup: keyboard });
}

async function startInvoice(chatId, user, key) {
  if (!cfg.livePurchases()) {
    return sendMessage(chatId, "🧪 المتجر في وضع الاختبار الآن. عرض المنتجات والترجمة يعملان، لكن الشراء الحقيقي مقفول حتى اعتماد حقول API.");
  }
  const p = await findProduct(key);
  if (!p) return sendMessage(chatId, "هذا المنتج لم يعد متاحًا.");
  const ar = await arabizeProduct(p);
  const stars = priceToStars(p.price);
  if (!stars) return sendMessage(chatId, "تعذر تحديد سعر هذا المنتج.");

  return tg("sendInvoice", {
    chat_id: chatId,
    title: ar.nameAr.slice(0, 32) || "منتج رقمي",
    description: (ar.descAr || "خدمة رقمية").slice(0, 255),
    payload: `buy:${p.key}:${stars}`,
    currency: "XTR",
    prices: [{ label: ar.nameAr.slice(0, 32) || "المنتج", amount: stars }],
  });
}

async function validateCheckout(q) {
  try {
    const [kind, key, chargedRaw] = String(q.invoice_payload || "").split(":");
    if (kind !== "buy") throw new Error("طلب غير صالح");
    const p = await findProduct(key);
    if (!p) throw new Error("المنتج لم يعد متاحًا");
    const expected = priceToStars(p.price);
    const charged = Number(chargedRaw);
    if (!expected || expected !== charged || q.total_amount !== charged || q.currency !== "XTR") {
      throw new Error("تغير السعر. أعد فتح المنتج وحاول من جديد");
    }
    await tg("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok: true });
  } catch (e) {
    await tg("answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id,
      ok: false,
      error_message: `تعذر إكمال الطلب: ${e.message}`.slice(0, 200),
    });
  }
}

async function deliverPaidOrder(message) {
  const payment = message.successful_payment;
  const user = message.from;
  const chatId = message.chat.id;
  const [kind, key, chargedRaw] = String(payment.invoice_payload || "").split(":");
  const charged = Number(chargedRaw);
  try {
    if (kind !== "buy") throw new Error("حمولة الدفع غير صالحة");
    const p = await findProduct(key);
    if (!p) throw new Error("المنتج اختفى من المورد");
    const expected = priceToStars(p.price);
    if (!expected || expected !== charged || payment.total_amount !== charged || payment.currency !== "XTR") {
      throw new Error("السعر تغيّر بعد الدفع");
    }

    await sendMessage(chatId, "✅ تم استلام الدفع. جاري تنفيذ طلبك الآن...");
    const result = await purchaseProduct(p, user, `tg-charge-${payment.telegram_payment_charge_id}`);
    await sendLongMessage(chatId, `✅ تم تنفيذ الطلب بنجاح.\n\n${JSON.stringify(result, null, 2)}`);

    const adminId = cfg.adminId();
    if (adminId) await sendMessage(adminId, `✅ طلب ناجح\nالمستخدم: ${user.id}${user.username ? ` @${user.username}` : ""}\nالمنتج: ${p.name}\nالمدفوع: ${charged} ⭐`);
  } catch (e) {
    try {
      await tg("refundStarPayment", {
        user_id: user.id,
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
      });
      await sendMessage(chatId, `❌ تعذر تنفيذ الطلب لدى المورد، وتمت إعادة ${payment.total_amount} نجمة لك تلقائيًا.\n\nالسبب: ${e.message}`);
    } catch (refundError) {
      await sendMessage(chatId, "⚠️ تعذر تنفيذ الطلب وتعذر الرد الآلي للمبلغ. تم إرسال الحالة للإدارة لمراجعتها فورًا.");
      const adminId = cfg.adminId();
      if (adminId) await sendLongMessage(adminId, `🚨 فشل طلب + فشل Refund\nUser: ${user.id}\nCharge: ${payment.telegram_payment_charge_id}\nPurchase error: ${e.message}\nRefund error: ${refundError.message}`);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== cfg.webhookSecret()) return res.status(401).json({ ok: false });

  try {
    const u = req.body || {};
    if (u.pre_checkout_query) {
      await validateCheckout(u.pre_checkout_query);
    } else if (u.message?.successful_payment) {
      await deliverPaidOrder(u.message);
    } else if (u.message) {
      const text = String(u.message.text || "").trim().toLowerCase();
      if (text === "/products" || text === "المنتجات") await showProducts(u.message.chat.id);
      else if (text === "/help") await sendMessage(u.message.chat.id, "استخدم /products لعرض المنتجات. الأسعار المعروضة بالنجوم وتشمل هامش المتجر المحدد من الإدارة.");
      else await showHome(u.message.chat.id);
    } else if (u.callback_query) {
      const q = u.callback_query;
      await answerCallbackQuery(q.id);
      const data = String(q.data || "");
      if (data === "home") await showHome(q.message.chat.id);
      else if (data === "products") await showProducts(q.message.chat.id);
      else if (data === "help") await sendMessage(q.message.chat.id, "اختر المنتجات، افتح المنتج، ثم اشترِ باستخدام Telegram Stars عندما يكون المتجر في وضع التشغيل الفعلي.");
      else if (data.startsWith("p:")) await showProduct(q.message.chat.id, data.slice(2));
      else if (data.startsWith("buy:")) await startInvoice(q.message.chat.id, q.from, data.slice(4));
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}
