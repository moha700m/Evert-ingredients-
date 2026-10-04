import { cfg } from './_lib/config.js';
import { tg } from './_lib/telegram.js';

export default async function handler(req, res) {
  try {
    const repair = req.query?.repair === '1';
    if (repair) {
      const setupSecret = cfg.setupSecret();
      if (!setupSecret || req.query?.secret !== setupSecret) return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const configured = cfg.publicBaseUrl();
    if (repair && !configured) return res.status(503).json({ ok: false, error: 'public_base_url_not_configured' });
    const webhookUrl = configured ? `${configured}/api/telegram` : '';
    const me = await tg('getMe');
    const before = await tg('getWebhookInfo');

    const wrongUrl = Boolean(webhookUrl) && String(before?.url || '') !== webhookUrl;
    const telegramReportedError = Boolean(before?.last_error_message);
    let repaired = false;

    if (repair && (wrongUrl || telegramReportedError || req.query?.force === '1')) {
      await tg('setWebhook', {
        url: webhookUrl,
        secret_token: cfg.webhookSecret(),
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
        drop_pending_updates: false,
      });
      repaired = true;
    }

    const after = repaired ? await tg('getWebhookInfo') : before;
    const result = {
      ok: true,
      service: 'arabic-telegram-store',
      bot: String(me?.username || ''),
      webhook: {
        url: String(after?.url || ''),
        expectedUrl: webhookUrl || null,
        matchesProductionUrl: webhookUrl ? String(after?.url || '') === webhookUrl : null,
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
    if (req.query?.text === '1') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      return res.status(500).send('ok=false\nerror=health_check_failed');
    }
    return res.status(500).json({ ok: false, error: 'health_check_failed' });
  }
}
