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

function auditText(products) {
  const types = new Map();
  let missingIds = 0;
  let missingPrices = 0;
  let withRequirements = 0;
  let autoPurchase = 0;
  let availableKnown = 0;
  let outOfStock = 0;

  for (const product of products) {
    if (!product.sourceIdValid) missingIds += 1;
    if (!Number.isFinite(product.price)) missingPrices += 1;
    if (product.requiresInput) withRequirements += 1;
    if (canAutoPurchase(product)) autoPurchase += 1;
    if (typeof product?.availability?.available === 'number') {
      availableKnown += 1;
      if (product.availability.available <= 0) outOfStock += 1;
    }
    const type = product.productType || 'normal';
    types.set(type, (types.get(type) || 0) + 1);
  }

  const typeSummary = [...types.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${count}`)
    .join(',');

  return [
    'ok=true',
    `total=${products.length}`,
    `missing_ids=${missingIds}`,
    `missing_prices=${missingPrices}`,
    `with_requirements=${withRequirements}`,
    `auto_purchase=${autoPurchase}`,
    `availability_known=${availableKnown}`,
    `out_of_stock=${outOfStock}`,
    `types=${typeSummary}`,
  ].join('\n');
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

    if (req.query?.audit === '1') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(auditText(products));
    }

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
        requiresInput: Boolean(product.requiresInput),
        type: product.productType || '',
      }));

    return res.status(200).json({
      ok: true,
      storeTitle: runtime?.storeTitle || 'كل شي',
      livePurchases: typeof runtime?.livePurchases === 'boolean' ? runtime.livePurchases : cfg.livePurchases(),
      botUsername: me?.username || '',
      totalProducts: output.length,
      products: output,
    });
  } catch (error) {
    console.error('catalog_error', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
}
