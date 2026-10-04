import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const setupSecret = cfg.setupSecret();
    if (!setupSecret || req.query?.secret !== setupSecret) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const me = await tg('getMe');
    const configured = cfg.publicBaseUrl();
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = configured || `${proto}://${host}`;
    const root = baseUrl.replace(/\/$/, '');
    const webhookUrl = `${root}/api/telegram`;

    const result = await tg('setWebhook', {
      url: webhookUrl,
      secret_token: cfg.webhookSecret(),
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false,
    });

    await tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'فتح المتجر' },
        { command: 'products', description: 'المنتجات' },
        { command: 'help', description: 'المساعدة' },
      ],
    });

    await tg('setChatMenuButton', { menu_button: { type: 'default' } });

    res.status(200).json({ ok: true, bot: me.username, webhook: webhookUrl, store: root, setWebhook: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'setup_failed' });
  }
}
