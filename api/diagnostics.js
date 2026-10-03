import { cfg } from "./_lib/config.js";
import { tg } from "./_lib/telegram.js";
import { fetchRawProducts, normalizeProducts } from "./_lib/products.js";

function describeShape(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (depth >= 2) return { type: "array" };
    return { type: "array", item: value.length ? describeShape(value[0], depth + 1) : "empty" };
  }
  if (typeof value === "object") {
    if (depth >= 2) return { type: "object", keys: Object.keys(value) };
    return {
      type: "object",
      fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, describeShape(child, depth + 1)])),
    };
  }
  return typeof value;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const result = {
    ok: true,
    livePurchases: cfg.livePurchases(),
    telegram: { configured: false, reachable: false },
    canboso: { configured: false, reachable: false, productsCount: null },
  };

  try {
    cfg.telegramToken();
    cfg.webhookSecret();
    result.telegram.configured = true;
    const me = await tg("getMe");
    const webhook = await tg("getWebhookInfo");
    result.telegram.reachable = true;
    result.telegram.bot = me?.username || null;
    result.telegram.webhookConfigured = Boolean(webhook?.url);
    result.telegram.webhookHost = webhook?.url ? new URL(webhook.url).host : null;
    result.telegram.pendingUpdates = webhook?.pending_update_count ?? null;
  } catch (e) {
    result.telegram.error = e.message;
    result.ok = false;
  }

  try {
    cfg.canbosoKey();
    result.canboso.configured = true;
    const raw = await fetchRawProducts();
    const products = normalizeProducts(raw);
    result.canboso.reachable = true;
    result.canboso.productsCount = products.length;
    result.canboso.sample = products.slice(0, 3).map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency,
      priceText: p.priceText,
      supplierPrice: p.raw?.price && typeof p.raw.price === "object"
        ? {
            amount: p.raw.price.amount ?? null,
            currency: p.raw.price.currency ?? null,
            text: p.raw.price.text ?? null,
          }
        : p.raw?.price ?? null,
    }));

    const first = products[0]?.raw;
    if (first && typeof first === "object" && !Array.isArray(first)) {
      result.canboso.schemaKeys = Object.keys(first);
      result.canboso.numericKeys = Object.entries(first)
        .filter(([, value]) => typeof value === "number")
        .map(([key]) => key);
      result.canboso.stringKeys = Object.entries(first)
        .filter(([, value]) => typeof value === "string")
        .map(([key]) => key);
      result.canboso.priceShape = describeShape(first.price);
      result.canboso.availabilityShape = describeShape(first.availability);
      result.canboso.promotionsShape = describeShape(first.promotions);
    }
  } catch (e) {
    result.canboso.error = e.message;
    result.ok = false;
  }

  return res.status(result.ok ? 200 : 503).json(result);
}
