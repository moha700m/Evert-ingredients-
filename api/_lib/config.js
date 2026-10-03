export const env = (name, fallback = "") => process.env[name] ?? fallback;

export function required(name) {
  const value = env(name).trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function boolEnv(name, fallback = false) {
  const value = env(name, String(fallback)).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

export function csvEnv(name, fallback) {
  return env(name, fallback).split(",").map(v => v.trim()).filter(Boolean);
}

function numberEnv(names, fallback) {
  for (const name of names) {
    const raw = env(name).trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

export const cfg = {
  telegramToken: () => required("TELEGRAM_BOT_TOKEN"),
  adminId: () => env("TELEGRAM_ADMIN_ID").trim(),
  webhookSecret: () => required("WEBHOOK_SECRET"),
  setupSecret: () => required("SETUP_SECRET"),
  publicBaseUrl: () => env("PUBLIC_BASE_URL").trim().replace(/\/$/, ""),
  canbosoKey: () => required("CANBOSO_API_KEY"),
  canbosoBaseUrl: () => env("CANBOSO_BASE_URL", "https://canboso.com").replace(/\/$/, ""),
  productsPath: () => env("CANBOSO_PRODUCTS_PATH", "/api/v2/telegram-buyer/products"),
  purchasePath: () => env("CANBOSO_PURCHASE_PATH", "/api/v2/telegram-buyer/purchase"),
  livePurchases: () => boolEnv("ENABLE_LIVE_PURCHASES", false),
  // Accept both names so existing Vercel configs keep working.
  starRate: () => numberEnv(["STAR_RATE", "STARS_PER_USD"], 1),
  markup: () => Number(env("MARKUP_PERCENT", "25")) || 0,
  idKeys: () => csvEnv("PRODUCT_ID_KEYS", "id,product_id,uuid,sku"),
  nameKeys: () => csvEnv("PRODUCT_NAME_KEYS", "name,title,product_name"),
  descKeys: () => csvEnv("PRODUCT_DESC_KEYS", "description,desc,details"),
  priceKeys: () => csvEnv("PRODUCT_PRICE_KEYS", "price,amount,cost"),
};
