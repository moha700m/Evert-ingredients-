import { cfg } from "./_lib/config.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  return res.status(200).json({ ok: true, livePurchases: cfg.livePurchases() });
}
