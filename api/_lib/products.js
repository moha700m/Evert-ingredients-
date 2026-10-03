import crypto from "node:crypto";
import { cfg, env } from "./config.js";
import { toArabic } from "./translate.js";

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function findFirstArray(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return null;
  for (const key of ["products", "data", "items", "results", "result"]) {
    if (key in value) {
      const found = findFirstArray(value[key], depth + 1);
      if (found) return found;
    }
  }
  for (const v of Object.values(value)) {
    const found = findFirstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function authCandidates() {
  const key = cfg.canbosoKey();
  const explicitHeader = env("CANBOSO_AUTH_HEADER").trim();
  const explicitPrefix = env("CANBOSO_AUTH_PREFIX").trim();
  if (explicitHeader) {
    return [{ [explicitHeader]: explicitPrefix ? `${explicitPrefix} ${key}` : key }];
  }
  return [
    { "x-buyer-key": key },
    { Authorization: `Bearer ${key}` },
    { Authorization: key },
    { "X-API-Key": key },
    { "x-api-key": key },
    { "Api-Key": key },
  ];
}

function isMissingApiKeyError(status, data) {
  if (status !== 400) return false;
  const text = JSON.stringify(data || {}).toLowerCase();
  return text.includes("thieu key api") ||
    text.includes("missing api key") ||
    text.includes("api key missing") ||
    text.includes("missing key api");
}

async function upstream(path, init = {}) {
  const url = `${cfg.canbosoBaseUrl()}${path}`;
  let last;
  for (const auth of authCandidates()) {
    const r = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...auth,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (r.ok) return data;
    last = { status: r.status, data };
    const retryAuth = [401, 403].includes(r.status) || isMissingApiKeyError(r.status, data);
    if (!retryAuth) break;
  }
  throw new Error(`Canboso API error ${last?.status || "unknown"}: ${JSON.stringify(last?.data || {})}`);
}

function parseNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[^0-9.-]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePrice(rawPrice) {
  if (rawPrice && typeof rawPrice === "object" && !Array.isArray(rawPrice)) {
    const amount = parseNumeric(rawPrice.amount ?? rawPrice.value ?? rawPrice.price);
    return {
      amount,
      currency: rawPrice.currency ? String(rawPrice.currency).toUpperCase() : "",
      text: rawPrice.text ? String(rawPrice.text) : "",
    };
  }
  return { amount: parseNumeric(rawPrice), currency: "", text: "" };
}

function productsPathWithBuyerKey() {
  const path = cfg.productsPath();
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}key=${encodeURIComponent(cfg.canbosoKey())}`;
}

export async function fetchRawProducts() {
  return upstream(productsPathWithBuyerKey(), { method: "GET" });
}

export function normalizeProducts(raw) {
  const arr = findFirstArray(raw) || [];
  return arr.filter(x => x && typeof x === "object").map((p, index) => {
    const id = getFirst(p, cfg.idKeys()) ?? index;
    const name = getFirst(p, cfg.nameKeys()) ?? `Product ${index + 1}`;
    const description = getFirst(p, cfg.descKeys()) ?? "";
    const rawPrice = getFirst(p, cfg.priceKeys());
    const normalizedPrice = normalizePrice(rawPrice);
    const stable = String(id);
    const key = crypto.createHash("sha256").update(stable).digest("hex").slice(0, 12);
    return {
      id: stable,
      key,
      name: String(name),
      description: String(description),
      productType: p.productType ? String(p.productType) : "",
      purchaseRequirements: p.purchaseRequirements ?? null,
      availability: p.availability ?? null,
      price: normalizedPrice.amount,
      currency: normalizedPrice.currency,
      priceText: normalizedPrice.text,
      raw: p,
    };
  });
}

export async function fetchProducts() {
  return normalizeProducts(await fetchRawProducts());
}

export async function arabizeProduct(p) {
  const [nameAr, descAr] = await Promise.all([toArabic(p.name), toArabic(p.description)]);
  return { ...p, nameAr, descAr };
}

export function canAutoPurchase(product) {
  if (!product) return false;
  if (product.id === "slot_chatgpt_business") return false;
  if (["slot", "upgrade_account"].includes(String(product.productType || "").toLowerCase())) return false;
  return !product.purchaseRequirements;
}

export function priceToStars(price) {
  if (!Number.isFinite(price) || price < 0) return null;
  const stars = Math.ceil(price * cfg.starRate() * (1 + cfg.markup() / 100));
  return Math.max(1, stars);
}

function renderTemplate(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
  }
  if (Array.isArray(value)) return value.map(v => renderTemplate(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, vars)]));
  }
  return value;
}

export async function purchaseProduct(product, user, idempotencyKey = "") {
  if (!canAutoPurchase(product)) throw new Error("هذا المنتج يتطلب بيانات إضافية قبل الشراء");

  let template;
  try {
    template = JSON.parse(env("PURCHASE_BODY_TEMPLATE", '{"key":"{{buyer_key}}","product_id":"{{product_id}}","quantity":1}'));
  } catch {
    throw new Error("PURCHASE_BODY_TEMPLATE is not valid JSON");
  }

  const body = renderTemplate(template, {
    buyer_key: cfg.canbosoKey(),
    product_id: product.id,
    telegram_user_id: user?.id ?? "",
    telegram_username: user?.username ?? "",
  });

  // Swagger requires the buyer key inside the purchase JSON body.
  if (!body.key) body.key = cfg.canbosoKey();
  if (!body.product_id) body.product_id = product.id;
  if (!body.quantity) body.quantity = 1;

  return upstream(cfg.purchasePath(), {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey || `telegram-${user?.id || "unknown"}-${product.key}-${Date.now()}` },
    body: JSON.stringify(body),
  });
}
