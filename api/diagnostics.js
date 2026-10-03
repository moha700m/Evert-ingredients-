import { cfg } from "./_lib/config.js";
import { tg } from "./_lib/telegram.js";
import { fetchRawProducts, normalizeProducts } from "./_lib/products.js";

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
    result.canboso.sample = products.slice(0, 3).map(p => ({ id: p.id, name: p.name, price: p.price }));
  } catch (e) {
    result.canboso.error = e.message;
    result.ok = false;
  }

  return res.status(result.ok ? 200 : 503).json(result);
}
