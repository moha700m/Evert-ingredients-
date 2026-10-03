import { env } from "./config.js";

const cache = new Map();

function overrides() {
  try { return JSON.parse(env("AR_OVERRIDES_JSON", "{}")); }
  catch { return {}; }
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text || "");
}

export async function toArabic(text) {
  const src = String(text ?? "").trim();
  if (!src || hasArabic(src)) return src;
  const manual = overrides()[src];
  if (manual) return String(manual);
  if (cache.has(src)) return cache.get(src);

  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", "ar");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", src.slice(0, 3000));
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`translation status ${r.status}`);
    const data = await r.json();
    const out = Array.isArray(data?.[0])
      ? data[0].map(part => part?.[0] || "").join("").trim()
      : src;
    cache.set(src, out || src);
    return out || src;
  } catch {
    return src;
  }
}
