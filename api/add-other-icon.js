import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

const NONCE = 'bIDtvgW5tkwgoIXDNRw63MlVdVksKX_OyP48WZo2bMs';
const ICON_URL = 'https://evert-ingredients.vercel.app/api/other-icon';

export default async function handler(req, res) {
  if (req.query?.nonce !== NONCE) return res.status(401).json({ ok: false });

  try {
    const me = await tg('getMe');
    const owner = Number(cfg.adminId());
    if (!Number.isSafeInteger(owner)) throw new Error('TELEGRAM_ADMIN_ID is required');

    const setName = `brand_icons_v2_by_${me.username}`;
    let set = await tg('getStickerSet', { name: setName });

    if ((set.stickers?.length || 0) < 33) {
      await tg('addStickerToSet', {
        user_id: owner,
        name: setName,
        sticker: {
          sticker: ICON_URL,
          format: 'static',
          emoji_list: ['📦'],
          keywords: ['other', 'more'],
        },
      });
      set = await tg('getStickerSet', { name: setName });
    }

    const sticker = set.stickers?.[set.stickers.length - 1];
    if (!sticker?.custom_emoji_id) throw new Error('custom emoji id not found');

    return res.status(200).json({
      ok: true,
      setName,
      count: set.stickers.length,
      customEmojiId: sticker.custom_emoji_id,
    });
  } catch (error) {
    console.error('add_other_icon_failed', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
