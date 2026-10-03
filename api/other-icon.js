import sharp from 'sharp';

const SVG = `
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="88" height="88" rx="24" fill="#1F2937"/>
  <rect x="24" y="28" width="52" height="44" rx="10" fill="#F3F4F6"/>
  <path d="M31 40h38M31 50h38M31 60h24" stroke="#1F2937" stroke-width="6" stroke-linecap="round"/>
  <circle cx="68" cy="62" r="8" fill="#9CA3AF"/>
</svg>`;

export default async function handler(req, res) {
  try {
    const png = await sharp(Buffer.from(SVG))
      .resize(100, 100, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(200).send(png);
  } catch (error) {
    console.error('other_icon_failed', error);
    return res.status(500).json({ ok: false, error: 'icon_failed' });
  }
}
