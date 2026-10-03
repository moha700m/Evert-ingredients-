import { cfg } from './_lib/config.js';
import { fetchProducts, canAutoPurchase } from './_lib/products.js';
import { getRuntimeConfig } from './_lib/runtime-config.js';
import { tg } from './_lib/telegram.js';

function priceToStars(price, runtime) {
  if (!Number.isFinite(price) || price < 0) return null;
  const rate = Number(runtime?.starRate) > 0 ? Number(runtime.starRate) : cfg.starRate();
  const markup = Number.isFinite(Number(runtime?.markupPercent)) ? Number(runtime.markupPercent) : cfg.markup();
  return Math.max(1, Math.ceil(price * rate * (1 + markup / 100)));
}

function hiddenIds(runtime) {
  return new Set(Array.isArray(runtime?.hiddenProductIds) ? runtime.hiddenProductIds.map(String) : []);
}

function shortText(value, max = 92) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const runtime = await getRuntimeConfig();
    const hidden = hiddenIds(runtime);
    const [products, me] = await Promise.all([
      fetchProducts(),
      tg('getMe').catch(() => null),
    ]);

    const output = products
      .filter(product => !hidden.has(String(product.id)))
      .map(product => ({
        id: product.id,
        key: product.key,
        name: shortText(product.name, 86),
        stars: priceToStars(product.price, runtime),
        available: typeof product?.availability?.available === 'number' ? product.availability.available : null,
        sold: typeof product?.availability?.sold === 'number' ? product.availability.sold : null,
        autoPurchase: canAutoPurchase(product),
        type: product.productType || '',
      }));

    return res.status(200).json({
      ok: true,
      storeTitle: runtime?.storeTitle || 'كل شي',
      livePurchases: typeof runtime?.livePurchases === 'boolean' ? runtime.livePurchases : cfg.livePurchases(),
      botUsername: me?.username || '',
      products: output,
    });
  } catch (error) {
    console.error('catalog_error', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
}
