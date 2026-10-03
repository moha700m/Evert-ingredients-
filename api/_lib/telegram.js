import { cfg } from './config.js';

const API = () => `https://api.telegram.org/bot${cfg.telegramToken()}`;

const BRAND_BUTTONS = {
  chatgpt: ['5911484044368945441', 'ChatGPT'],
  google: ['5908831524106543117', 'Google'],
  capcut: ['5911347404279389388', 'CapCut'],
  gmail: ['5911422892624585135', 'Gmail'],
  canva: ['5909275915782725346', 'Canva'],
  claude: ['5908932829500154391', 'Claude'],
  meitu: ['5911456135671456872', 'Meitu'],
  nordvpn: ['5908802653336380011', 'NordVPN'],
  telegram: ['5911022352564493434', 'Telegram'],
  hmavpn: ['5910994787464388671', 'HMA VPN'],
  notion: ['5911372920680095345', 'Notion'],
  autodesk: ['5911528046308894163', 'AutoDesk'],
  scribd: ['5911529334799081410', 'SCRIBD'],
  cursor: ['5911233269818465613', 'Cursor'],
  kling: ['5909109597469156983', 'Kling'],
  youtube: ['5911021055484370487', 'Youtube'],
  zoom: ['5911180995771506005', 'Zoom'],
  outlook: ['5911528720618757248', 'Outlook'],
  tiktok: ['5911230808802206251', 'TikTok'],
  figma: ['5911138428350635815', 'Figma'],
  duolingo: ['5908914223701828166', 'Duolingo'],
  krea: ['5911222098608528570', 'Krea'],
  wink: ['5908848029665861367', 'Wink'],
  adobe: ['5911375201307728859', 'Adobe'],
  tradingview: ['5908877604810661948', 'TradingView'],
  microsoft: ['5911167561113804482', 'Microsoft'],
  lovable: ['5909092597988597933', 'Lovable'],
  seedance: ['5911049939139436117', 'Seedance'],
  quizlet: ['5911385663848062428', 'Quizlet'],
  hotspot: ['5911523360499573394', 'Hotspot VPN'],
  spotify: ['5911295748707720801', 'Spotify'],
  perplexity: ['5908810719284962149', 'Perplexity'],
};

function enhanceBrandButtons(extra) {
  const markup = extra?.reply_markup;
  if (!markup?.inline_keyboard) return extra;

  const inlineKeyboard = markup.inline_keyboard.map(row => row.map(button => {
    const data = String(button?.callback_data || '');
    if (!data.startsWith('cat:')) return button;
    const slug = data.slice(4);
    const brand = BRAND_BUTTONS[slug];
    if (!brand) return button;
    const [iconId, label] = brand;
    return { ...button, text: label, icon_custom_emoji_id: iconId };
  }));

  return {
    ...extra,
    reply_markup: { ...markup, inline_keyboard: inlineKeyboard },
  };
}

export async function tg(method, body = {}) {
  const r = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || r.status}`);
  }
  return data.result;
}

export function sendMessage(chatId, text, extra = {}) {
  const enhanced = enhanceBrandButtons(extra);
  return tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4096), ...enhanced });
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
