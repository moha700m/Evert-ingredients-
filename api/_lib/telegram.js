import { cfg } from "./config.js";

const API = () => `https://api.telegram.org/bot${cfg.telegramToken()}`;

export async function tg(method, body = {}) {
  const r = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || r.status}`);
  }
  return data.result;
}

export function sendMessage(chatId, text, extra = {}) {
  return tg("sendMessage", { chat_id: chatId, text: String(text).slice(0, 4096), ...extra });
}

export async function sendLongMessage(chatId, text) {
  const s = String(text);
  for (let i = 0; i < s.length; i += 3900) {
    await sendMessage(chatId, s.slice(i, i + 3900));
  }
}

export function answerCallbackQuery(id, text = "") {
  return tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}
