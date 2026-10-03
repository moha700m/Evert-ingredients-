import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

function requestBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Missing request host');
  return `${proto}://${host}`.replace(/\/$/, '');
}

export default async function handler(req, res) {
  try {
    const root = requestBaseUrl(req);
    const webhookUrl = `${root}/api/telegram`;
    const me = await tg('getMe');
    const before = await tg('getWebhookInfo');

    const wrongUrl = String(before?.url || '') !== webhookUrl;
    const telegramReportedError = Boolean(before?.last_error_message);
    let repaired = false;

    if (wrongUrl || telegramReportedError || req.query?.repair === '1') {
      await tg('setWebhook', {
        url: webhookUrl,
        secret_token: cfg.webhookSecret(),
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
        drop_pending_updates: false,
      });
      repaired = true;
    }

    const after = await tg('getWebhookInfo');
    const result = {
      ok: true,
      service: 'arabic-telegram-store',
      bot: String(me?.username || ''),
      webhook: {
        url: String(after?.url || ''),
        pendingUpdates: Number(after?.pending_update_count || 0),
        lastErrorDate: after?.last_error_date || null,
        lastErrorMessage: String(after?.last_error_message || ''),
        repaired,
      },
      time: new Date().toISOString(),
    };

    if (req.query?.text === '1') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      return res.status(200).send([
        `ok=${result.ok}`,
        `bot=@${result.bot}`,
        `webhook=${result.webhook.url}`,
        `pending=${result.webhook.pendingUpdates}`,
        `last_error=${result.webhook.lastErrorMessage || 'none'}`,
        `repaired=${result.webhook.repaired}`,
      ].join('\n'));
    }

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (req.query?.text === '1') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      return res.status(500).send(`ok=false\nerror=${message}`);
    }
    return res.status(500).json({ ok: false, error: message });
  }
}
