import { env } from './config.js';

const DEFAULT_URL = 'https://api-v2.appdeploy.ai/app/bot-control-center-pkbs0c/api/public-config';
let cache = { at: 0, value: null };

function numberOrNull(value, positive = false) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && (!positive || number > 0) ? number : null;
}

function normalize(settings) {
  if (!settings || typeof settings !== 'object') return null;
  return {
    storeTitle: String(settings.storeTitle || '').trim(),
    welcomeMessage: String(settings.welcomeMessage || '').trim(),
    helpMessage: String(settings.helpMessage || '').trim(),
    livePurchases: typeof settings.livePurchases === 'boolean' ? settings.livePurchases : null,
    markupPercent: numberOrNull(settings.markupPercent),
    starRate: numberOrNull(settings.starRate, true),
    productsPageSize: numberOrNull(settings.productsPageSize, true),
    // Always expose every product returned by Canboso. Runtime hiding is intentionally disabled.
    hiddenProductIds: [],
  };
}

export async function getRuntimeConfig({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache.value && now - cache.at < 5000) return cache.value;

  const url = env('CONTROL_PANEL_CONFIG_URL', DEFAULT_URL).trim() || DEFAULT_URL;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`control panel status ${response.status}`);
    const data = await response.json();
    const value = normalize(data?.settings);
    if (!value) throw new Error('invalid control panel config');
    cache = { at: now, value };
    return value;
  } catch (error) {
    console.warn('runtime_config_fallback', error?.name || 'Error');
    return cache.value;
  }
}
