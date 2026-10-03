import { env } from './config.js';

const DEFAULT_URL = 'https://bot-control-center-pkbs0c.v2.appdeploy.ai/api/public-config';
let cache = { at: 0, value: null };

function normalize(settings) {
  if (!settings || typeof settings !== 'object') return null;
  return {
    storeTitle: String(settings.storeTitle || '').trim(),
    welcomeMessage: String(settings.welcomeMessage || '').trim(),
    helpMessage: String(settings.helpMessage || '').trim(),
    livePurchases: typeof settings.livePurchases === 'boolean' ? settings.livePurchases : null,
    markupPercent: Number.isFinite(Number(settings.markupPercent)) ? Number(settings.markupPercent) : null,
    starRate: Number.isFinite(Number(settings.starRate)) && Number(settings.starRate) > 0 ? Number(settings.starRate) : null,
    productsPageSize: Number.isFinite(Number(settings.productsPageSize)) ? Number(settings.productsPageSize) : null,
    hiddenProductIds: Array.isArray(settings.hiddenProductIds) ? settings.hiddenProductIds.map(String) : [],
  };
}

export async function getRuntimeConfig() {
  const now = Date.now();
  if (cache.value && now - cache.at < 5000) return cache.value;

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
    console.warn('runtime_config_fallback', error.message);
    return cache.value;
  }
}
