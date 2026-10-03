import { cfg } from "./_lib/config.js";
import { fetchRawProducts, normalizeProducts } from "./_lib/products.js";

export default async function handler(req, res) {
  try {
    if (req.query?.secret !== cfg.setupSecret()) return res.status(401).json({ ok: false, error: "unauthorized" });
    const raw = await fetchRawProducts();
    const normalized = normalizeProducts(raw);
    res.status(200).json({
      ok: true,
      count: normalized.length,
      normalizedSample: normalized.slice(0, 3).map(({ raw, ...rest }) => rest),
      rawSample: Array.isArray(raw) ? raw.slice(0, 2) : raw,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
