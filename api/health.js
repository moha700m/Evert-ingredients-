export default function handler(req, res) {
  res.status(200).json({ ok: true, service: "arabic-telegram-store", time: new Date().toISOString() });
}
