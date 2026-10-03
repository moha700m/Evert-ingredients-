import sharp from 'sharp';

const allowed = /^[a-z0-9.-]{1,120}$/i;

export default async function handler(req, res) {
  try {
    const domain = String(req.query?.domain || '').trim().toLowerCase();
    if (!allowed.test(domain)) return res.status(400).json({ ok: false, error: 'invalid_domain' });

    const source = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
    const upstream = await fetch(source, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) throw new Error(`favicon ${upstream.status}`);

    const input = Buffer.from(await upstream.arrayBuffer());
    const png = await sharp(input)
      .resize(100, 100, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(png);
  } catch (error) {
    console.error('icon_proxy_failed', error);
    return res.status(500).json({ ok: false, error: 'icon_failed' });
  }
}
