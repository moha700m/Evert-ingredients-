import { fetchProducts } from "./_lib/products.js";

export default async function handler(req, res) {
  try {
    const products = await fetchProducts();
    const matches = products
      .filter(p => /gmail|google mail|google account/i.test(`${p.name} ${p.description}`))
      .map(p => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: p.currency,
        availability: p.raw?.availability ?? null,
        productType: p.raw?.productType ?? null,
        purchaseRequirements: p.raw?.purchaseRequirements ?? null,
      }));
    res.status(200).json({ ok: true, count: matches.length, matches });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
