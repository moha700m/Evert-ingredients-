import { cfg } from './config.js';

const API = () => `https://api.telegram.org/bot${cfg.telegramToken()}`;

const CATEGORY_EMOJI = {
  apple: '🍎',
  chatgpt: '🤖',
  google: '🌈',
  capcut: '🎬',
  gmail: '📧',
  canva: '🎨',
  claude: '🟠',
  meitu: '📸',
  nordvpn: '🛡️',
  telegram: '✈️',
  hmavpn: '🥷',
  notion: '📝',
  autodesk: '🏗️',
  scribd: '📚',
  cursor: '🖱️',
  kling: '🎞️',
  youtube: '▶️',
  zoom: '📹',
  outlook: '📬',
  tiktok: '🎵',
  figma: '🧩',
  duolingo: '🦉',
  krea: '🖼️',
  wink: '✨',
  adobe: '🅰️',
  tradingview: '📈',
  microsoft: '🪟',
  lovable: '💜',
  seedance: '🎥',
  quizlet: '🧠',
  hotspot: '🌐',
  spotify: '🎧',
  perplexity: '🔎',
  other: '📦',
};

export function categoryButton(slug, fallbackLabel) {
  const icon = CATEGORY_EMOJI[slug] || '📦';
  return {
    text: `${icon} ${fallbackLabel}`,
    callback_data: `cat:${slug}`,
  };
}

export async function tg(method, body = {}, { timeoutMs = 4000 } = {}) {
  const r = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    const error = new Error(`Telegram ${method} failed`);
    error.status = r.status;
    error.code = Number(data.error_code) || 0;
    throw error;
  }
  return data.result;
}

export function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4096), ...extra });
}

export async function sendLongMessage(chatId, text) {
  const s = String(text);
  for (let i = 0; i < s.length; i += 3900) {
    await sendMessage(chatId, s.slice(i, i + 3900));
  }
}

export function answerCallbackQuery(id, text = '') {
  return tg('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
}
