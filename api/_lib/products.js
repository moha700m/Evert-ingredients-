import crypto from "node:crypto";
import { cfg, env } from "./config.js";
import { toArabic } from "./translate.js";

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function productArrayScore(arr) {
  if (!Array.isArray(arr) || !arr.length) return -1;
  let score = 0;
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.productId !== undefined || item.product_id !== undefined || item.id !== undefined) score += 4;
    if (item.name !== undefined || item.title !== undefined || item.product_name !== undefined) score += 3;
    if (item.price !== undefined || item.amount !== undefined || item.cost !== undefined) score += 3;
    if (item.productType !== undefined || item.availability !== undefined || item.purchaseRequirements !== undefined) score += 2;
  }
  return score;
}

function findProductsArray(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return null;

  const preferred = ["products", "items", "results", "data", "result"];
  for (const key of preferred) {
    if (!(key in value)) continue;
    const found = findProductsArray(value[key], depth + 1);
    if (found && (found.length === 0 || productArrayScore(found) >= 0)) return found;
  }

  let best = null;
  let bestScore = -1;
  for (const child of Object.values(value)) {
    const found = findProductsArray(child, depth + 1);
    if (!found) continue;
    const score = productArrayScore(found);
    if (score > bestScore) {
      best = found;
      bestScore = score;
    }
  }
  return best;
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

function upstreamUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${cfg.canbosoBaseUrl()}${path}`;
}

async function upstream(path, init = {}) {
  const url = upstreamUrl(path);
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
  const error = new Error(`Canboso API error ${last?.status || "unknown"}: ${JSON.stringify(last?.data || {})}`);
  error.status = last?.status || 0;
  error.data = last?.data || {};
  throw error;
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
    const amount = parseNumeric(rawPrice.amount ?? rawPrice.value ?? rawPrice.price ?? rawPrice.cost);
    return {
      amount,
      currency: rawPrice.currency ? String(rawPrice.currency).toUpperCase() : "",
      text: rawPrice.text ? String(rawPrice.text) : "",
    };
  }
  return { amount: parseNumeric(rawPrice), currency: "", text: "" };
}

function normalizeAvailability(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" || typeof raw === "string") {
    const available = parseNumeric(raw);
    return available === null ? { raw } : { available };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return { raw };
  const out = { ...raw };
  for (const key of ["available", "sold", "stock", "remaining", "quantity"]) {
    if (key in out) {
      const parsed = parseNumeric(out[key]);
      if (parsed !== null) out[key] = parsed;
    }
  }
  if (out.available === undefined) {
    const fallback = parseNumeric(out.stock ?? out.remaining ?? out.quantity);
    if (fallback !== null) out.available = fallback;
  }
  return out;
}

function hasRequirements(value) {
  if (value == null || value === false) return false;
  if (typeof value === "string") {
    const clean = value.trim();
    return clean !== "" && clean !== "[]" && clean !== "{}" && clean.toLowerCase() !== "null";
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function addBuyerKeyAndParams(path, params = {}) {
  const url = new URL(path, `${cfg.canbosoBaseUrl()}/`);
  if (!url.searchParams.has("key")) url.searchParams.set("key", cfg.canbosoKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function paginationInfo(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidates = [
    raw.pagination,
    raw.meta?.pagination,
    raw.data?.pagination,
    raw.meta,
    raw.data?.meta,
  ].filter(x => x && typeof x === "object" && !Array.isArray(x));

  for (const p of candidates) {
    const current = parseNumeric(p.page ?? p.currentPage ?? p.current_page);
    const total = parseNumeric(p.totalPages ?? p.total_pages ?? p.pages ?? p.lastPage ?? p.last_page);
    const nextPage = parseNumeric(p.nextPage ?? p.next_page);
    const nextCursor = p.nextCursor ?? p.next_cursor ?? null;
    const nextUrl = typeof p.next === "string" && /^https?:\/\//i.test(p.next) ? p.next : null;
    const hasNext = p.hasNext ?? p.has_next ?? p.hasMore ?? p.has_more;

    if (nextUrl || nextCursor || nextPage !== null || (current !== null && total !== null) || typeof hasNext === "boolean") {
      return { current, total, nextPage, nextCursor, nextUrl, hasNext };
    }
  }
  return null;
}

function sameCanbosoOrigin(url) {
  try {
    return new URL(url).origin === new URL(cfg.canbosoBaseUrl()).origin;
  } catch {
    return false;
  }
}

export async function fetchRawProducts() {
  const collected = [];
  let nextPath = addBuyerKeyAndParams(cfg.productsPath());
  const seen = new Set();

  for (let page = 0; page < 20 && nextPath; page += 1) {
    if (seen.has(nextPath)) break;
    seen.add(nextPath);

    const raw = await upstream(nextPath, { method: "GET" });
    const items = findProductsArray(raw) || [];
    collected.push(...items);

    const pagination = paginationInfo(raw);
    if (!pagination) break;

    if (pagination.nextUrl && sameCanbosoOrigin(pagination.nextUrl)) {
      nextPath = addBuyerKeyAndParams(pagination.nextUrl);
      continue;
    }
    if (pagination.nextCursor) {
      nextPath = addBuyerKeyAndParams(cfg.productsPath(), { cursor: pagination.nextCursor });
      continue;
    }
    if (pagination.nextPage !== null) {
      nextPath = addBuyerKeyAndParams(cfg.productsPath(), { page: pagination.nextPage });
      continue;
    }
    if (pagination.current !== null && pagination.total !== null && pagination.current < pagination.total) {
      nextPath = addBuyerKeyAndParams(cfg.productsPath(), { page: pagination.current + 1 });
      continue;
    }
    if (pagination.hasNext === false) break;
    break;
  }

  return { products: collected };
}

export function normalizeProducts(raw) {
  const arr = findProductsArray(raw) || [];
  const normalized = arr.filter(x => x && typeof x === "object" && !Array.isArray(x)).map((p, index) => {
    const rawId = getFirst(p, cfg.idKeys());
    const sourceIdValid = rawId !== undefined && String(rawId).trim() !== "";
    const fallbackHash = crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);
    const stable = sourceIdValid ? String(rawId) : `missing-id-${fallbackHash}`;
    const rawName = getFirst(p, cfg.nameKeys());
    const name = rawName !== undefined ? String(rawName) : `منتج بدون اسم ${index + 1}`;
    const description = getFirst(p, cfg.descKeys()) ?? "";
    const rawPrice = getFirst(p, cfg.priceKeys());
    const normalizedPrice = normalizePrice(rawPrice);
    const requirements = p.purchaseRequirements ?? p.purchase_requirements ?? null;
    const key = crypto.createHash("sha256").update(stable).digest("hex").slice(0, 12);

    return {
      id: stable,
      sourceIdValid,
      key,
      name,
      description: String(description),
      productType: String(p.productType ?? p.product_type ?? ""),
      purchaseRequirements: requirements,
      requiresInput: hasRequirements(requirements),
      availability: normalizeAvailability(p.availability ?? p.stock ?? null),
      price: normalizedPrice.amount,
      currency: normalizedPrice.currency,
      priceText: normalizedPrice.text,
      raw: p,
    };
  });

  const unique = [];
  const seen = new Set();
  for (const product of normalized) {
    const dedupeKey = product.sourceIdValid ? `id:${product.id}` : `fallback:${product.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push(product);
  }
  return unique;
}

export async function fetchProducts() {
  return normalizeProducts(await fetchRawProducts());
}

export async function arabizeProduct(p) {
  const [nameAr, descAr] = await Promise.all([toArabic(p.name), toArabic(p.description)]);
  return { ...p, nameAr, descAr };
}

export function purchaseInputFields(product) {
  const requirements = product?.purchaseRequirements;
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) return [];
  const metadata = new Set(["quantityFixed", "quantityMin", "quantityMax", "quantity", "minQuantity", "maxQuantity"]);
  return Object.entries(requirements)
    .filter(([key, value]) => !metadata.has(key) && (value === true || (value && typeof value === "object" && value.required === true)))
    .map(([key]) => key);
}

export function canPurchaseWithInput(product) {
  if (!product || !product.sourceIdValid) return false;
  const fields = purchaseInputFields(product);
  return fields.length > 0 && fields.every(field => field === "customerEmail");
}

export function canAutoPurchase(product) {
  if (!product || !product.sourceIdValid) return false;
  if (product.id === "slot_chatgpt_business") return false;
  if (["slot", "upgrade_account"].includes(String(product.productType || "").toLowerCase())) return false;
  return !product.requiresInput;
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

export async function purchaseProduct(product, user, idempotencyKey = "", inputs = {}) {
  if (!product || !product.sourceIdValid) throw new Error("بيانات المنتج غير صالحة للشراء");

  const inputFields = purchaseInputFields(product);
  if (inputFields.length) {
    if (!canPurchaseWithInput(product)) throw new Error("متطلبات هذا المنتج غير مدعومة تلقائياً");
    for (const field of inputFields) {
      if (!String(inputs[field] ?? "").trim()) throw new Error(`البيانات المطلوبة ناقصة: ${field}`);
    }
  } else if (!canAutoPurchase(product)) {
    throw new Error("هذا المنتج يحتاج تنفيذ خاص قبل الشراء");
  }

  let template;
  try {
    template = JSON.parse(env("PURCHASE_BODY_TEMPLATE", '{"key":"{{buyer_key}}","product_id":"{{product_id}}","quantity":1}'));
  } catch {
    throw new Error("PURCHASE_BODY_TEMPLATE is not valid JSON");
  }

  const baseBody = renderTemplate(template, {
    buyer_key: cfg.canbosoKey(),
    product_id: product.id,
    telegram_user_id: user?.id ?? "",
    telegram_username: user?.username ?? "",
  });

  if (!baseBody.key) baseBody.key = cfg.canbosoKey();
  if (!baseBody.product_id) baseBody.product_id = product.id;
  baseBody.quantity = 1;

  const customerEmail = String(inputs.customerEmail ?? "").trim();
  const variants = customerEmail
    ? [
        { ...baseBody, customer_email: customerEmail },
        { ...baseBody, customerEmail },
        { ...baseBody, email: customerEmail },
      ]
    : [baseBody];

  let lastError;
  for (let index = 0; index < variants.length; index += 1) {
    try {
      return await upstream(cfg.purchasePath(), {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey || `telegram-${user?.id || "unknown"}-${product.key}-${Date.now()}` },
        body: JSON.stringify(variants[index]),
      });
    } catch (error) {
      lastError = error;
      const mayTryFieldAlias = [400, 422].includes(Number(error.status));
      if (!mayTryFieldAlias || index === variants.length - 1) throw error;
    }
  }

  throw lastError || new Error("تعذر تنفيذ الطلب");
}
