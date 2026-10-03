import { cfg } from "./_lib/config.js";
import { tg } from "./_lib/telegram.js";

export default async function handler(req, res) {
  try {
    if (req.query?.secret !== cfg.setupSecret()) return res.status(401).json({ ok: false, error: "unauthorized" });
    const me = await tg("getMe");
    const configured = cfg.publicBaseUrl();
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = configured || `${proto}://${host}`;
    const url = `${baseUrl.replace(/\/$/, "")}/api/telegram`;
    const result = await tg("setWebhook", {
      url,
      secret_token: cfg.webhookSecret(),
      allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      drop_pending_updates: true,
    });
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "القائمة الرئيسية" },
        { command: "products", description: "عرض المنتجات" },
        { command: "help", description: "المساعدة" }
      ]
    });
    res.status(200).json({ ok: true, bot: me.username, webhook: url, setWebhook: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
