import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

const NONCE = 'diag_20261003_custom_emoji_7fK9sQ2xP4';
const ICON_ID = '5911484044368945441';

export default async function handler(req, res) {
  if (String(req.query?.nonce || '') !== NONCE) return res.status(401).json({ ok: false });
  try {
    const chatId = Number(cfg.adminId());
    if (!Number.isSafeInteger(chatId)) throw new Error('TELEGRAM_ADMIN_ID invalid');

    const stickers = await tg('getCustomEmojiStickers', { custom_emoji_ids: [ICON_ID] });
    const sent = await tg('sendMessage', {
      chat_id: chatId,
      text: '⭐ Custom emoji diagnostic',
      entities: [{ type: 'custom_emoji', offset: 0, length: 1, custom_emoji_id: ICON_ID }],
      reply_markup: {
        inline_keyboard: [[{
          text: 'ChatGPT',
          callback_data: 'diag:chatgpt',
          icon_custom_emoji_id: ICON_ID,
        }]],
      },
    });

    return res.status(200).json({
      ok: true,
      sticker: stickers?.[0] ? {
        custom_emoji_id: stickers[0].custom_emoji_id,
        type: stickers[0].type,
        is_animated: stickers[0].is_animated,
        is_video: stickers[0].is_video,
        set_name: stickers[0].set_name,
      } : null,
      reply_markup: sent?.reply_markup || null,
      message_id: sent?.message_id || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
