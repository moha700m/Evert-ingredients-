import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

const NONCE = 'rGCKXI3vooPSpPA9z9V_IpDFrmUY3poE';

const BRANDS = [
  ['chatgpt', 'chatgpt.com'],
  ['google', 'one.google.com'],
  ['capcut', 'capcut.com'],
  ['gmail', 'mail.google.com'],
  ['canva', 'canva.com'],
  ['claude', 'claude.ai'],
  ['meitu', 'meitu.com'],
  ['nordvpn', 'nordvpn.com'],
  ['telegram', 'telegram.org'],
  ['hmavpn', 'hidemyass.com'],
  ['notion', 'notion.so'],
  ['autodesk', 'autodesk.com'],
  ['scribd', 'scribd.com'],
  ['cursor', 'cursor.com'],
  ['kling', 'klingai.com'],
  ['youtube', 'youtube.com'],
  ['zoom', 'zoom.us'],
  ['outlook', 'outlook.live.com'],
  ['tiktok', 'tiktok.com'],
  ['figma', 'figma.com'],
  ['duolingo', 'duolingo.com'],
  ['krea', 'krea.ai'],
  ['wink', 'wink.ai'],
  ['adobe', 'adobe.com'],
  ['tradingview', 'tradingview.com'],
  ['microsoft', 'microsoft.com'],
  ['lovable', 'lovable.dev'],
  ['seedance', 'seedance.ai'],
  ['quizlet', 'quizlet.com'],
  ['hotspot', 'hotspotshield.com'],
  ['spotify', 'spotify.com'],
  ['perplexity', 'perplexity.ai'],
];

function favicon(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=100`;
}

async function botApi(method, body) {
  return tg(method, body);
}

export default async function handler(req, res) {
  if (req.query?.nonce !== NONCE) return res.status(401).json({ ok: false });
  try {
    const me = await botApi('getMe');
    const owner = Number(cfg.adminId());
    if (!Number.isSafeInteger(owner)) throw new Error('TELEGRAM_ADMIN_ID is required');
    const setName = `brand_icons_by_${me.username}`;

    let set;
    try {
      set = await botApi('getStickerSet', { name: setName });
    } catch {
      const stickers = BRANDS.map(([slug, domain]) => ({
        sticker: favicon(domain),
        format: 'static',
        emoji_list: ['✨'],
        keywords: [slug],
      }));
      await botApi('createNewStickerSet', {
        user_id: owner,
        name: setName,
        title: 'Brand Icons',
        stickers,
        sticker_type: 'custom_emoji',
      });
      set = await botApi('getStickerSet', { name: setName });
    }

    const mapping = {};
    for (let i = 0; i < BRANDS.length; i += 1) {
      const sticker = set.stickers?.[i];
      if (sticker?.custom_emoji_id) mapping[BRANDS[i][0]] = sticker.custom_emoji_id;
    }
    return res.status(200).json({ ok: true, setName, count: Object.keys(mapping).length, mapping });
  } catch (error) {
    console.error('custom_emoji_setup_failed', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
