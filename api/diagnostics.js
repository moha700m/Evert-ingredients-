import { cfg } from "./_lib/config.js";
import { tg } from "./_lib/telegram.js";
import { fetchProducts } from "./_lib/products.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const result = {
    ok: true,
    livePurchases: cfg.livePurchases(),
    telegram: { reachable: false, webhookConfigured: false },
    canboso: { reachable: false, productsCount: null },
  };

  try {
    const me = await tg("getMe");
    const webhook = await tg("getWebhookInfo");
    result.telegram = {
      reachable: true,
      bot: me?.username || null,
      webhookConfigured: Boolean(webhook?.url),
      webhookHost: webhook?.url ? new URL(webhook.url).host : null,
      pendingUpdates: webhook?.pending_update_count ?? null,
    };
  } catch (error) {
    result.ok = false;
    result.telegram.error = error.message;
  }

  try {
    const products = await fetchProducts();
    result.canboso = {
      reachable: true,
      productsCount: products.length,
    };
  } catch (error) {
    result.ok = false;
    result.canboso.error = error.message;
  }

  return res.status(result.ok ? 200 : 503).json(result);
}
