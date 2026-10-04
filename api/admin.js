import crypto from 'node:crypto';
import { cfg } from './_lib/config.js';
import { tg, sendMessage } from './_lib/telegram.js';
import { fetchProducts } from './_lib/products.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res) {
  const supplied = req.headers['x-admin-secret'];
  if (!safeEqual(supplied, cfg.setupSecret())) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

async function canbosoBalance() {
  const url = new URL(`${cfg.canbosoBaseUrl()}/api/v2/telegram-buyer/balance`);
  url.searchParams.set('key', cfg.canbosoKey());
  const r = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) throw new Error(`Canboso balance failed: ${r.status}`);
  return {
    walletCurrency: data.walletCurrency || null,
    balance: data.balance ?? null,
    balanceText: data.balanceText || null,
    balanceUsd: data.balanceUsd ?? null,
    balanceVnd: data.balanceVnd ?? null,
    usdtBalance: data.usdtBalance ?? null,
    updatedAt: data.updatedAt || null,
  };
}

async function status() {
  const [me, webhook, commands, nameInfo, descriptionInfo, shortDescriptionInfo, products] = await Promise.all([
    tg('getMe'),
    tg('getWebhookInfo'),
    tg('getMyCommands'),
    tg('getMyName').catch(() => null),
    tg('getMyDescription').catch(() => null),
    tg('getMyShortDescription').catch(() => null),
    fetchProducts(),
  ]);

  let balance = null;
  let balanceError = null;
  try {
    balance = await canbosoBalance();
  } catch (error) {
    balanceError = error.message;
  }

  return {
    ok: true,
    bot: {
      id: me.id,
      username: me.username,
      name: nameInfo?.name || me.first_name || '',
      description: descriptionInfo?.description || '',
      shortDescription: shortDescriptionInfo?.short_description || '',
      canJoinGroups: Boolean(me.can_join_groups),
      supportsInlineQueries: Boolean(me.supports_inline_queries),
    },
    webhook: {
      url: webhook.url || '',
      pendingUpdates: webhook.pending_update_count || 0,
      lastErrorDate: webhook.last_error_date || null,
      lastErrorMessage: webhook.last_error_message || '',
      maxConnections: webhook.max_connections || null,
      ipAddress: webhook.ip_address || '',
    },
    commands,
    canboso: {
      connected: true,
      productsCount: products.length,
      balance,
      balanceError,
    },
    fallbackSettings: {
      livePurchases: cfg.livePurchases(),
      markupPercent: cfg.markup(),
      starRate: cfg.starRate(),
    },
  };
}

function sanitizeCommands(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => ({
    command: String(item?.command || '').trim().replace(/^\//, '').slice(0, 32),
    description: String(item?.description || '').trim().slice(0, 256),
  })).filter(item => /^[a-z0-9_]{1,32}$/.test(item.command) && item.description);
}

async function handleAction(body) {
  const action = String(body?.action || '');

  if (action === 'setWebhook') {
    const url = String(body?.url || '').trim();
    if (!/^https:\/\//i.test(url)) throw new Error('Webhook URL must use HTTPS');
    await tg('setWebhook', {
      url,
      secret_token: cfg.webhookSecret(),
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: Boolean(body?.dropPendingUpdates),
    });
    return { ok: true, webhook: await tg('getWebhookInfo') };
  }

  if (action === 'deleteWebhook') {
    await tg('deleteWebhook', { drop_pending_updates: Boolean(body?.dropPendingUpdates) });
    return { ok: true, webhook: await tg('getWebhookInfo') };
  }

  if (action === 'setProfile') {
    const name = String(body?.name || '').trim().slice(0, 64);
    const description = String(body?.description || '').trim().slice(0, 512);
    const shortDescription = String(body?.shortDescription || '').trim().slice(0, 120);
    if (name) await tg('setMyName', { name });
    await tg('setMyDescription', { description });
    await tg('setMyShortDescription', { short_description: shortDescription });
    return { ok: true };
  }

  if (action === 'setCommands') {
    const commands = sanitizeCommands(body?.commands);
    if (!commands.length) throw new Error('At least one valid command is required');
    await tg('setMyCommands', { commands });
    return { ok: true, commands: await tg('getMyCommands') };
  }

  if (action === 'sendTest') {
    const adminId = cfg.adminId();
    if (!adminId) throw new Error('TELEGRAM_ADMIN_ID is not configured');
    const text = String(body?.text || '✅ اختبار لوحة التحكم: اتصال البوت يعمل بنجاح.').slice(0, 1000);
    const message = await sendMessage(adminId, text);
    return { ok: true, messageId: message?.message_id || null };
  }

  throw new Error('Unknown action');
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action || 'status');
      if (action === 'status') return res.status(200).json(await status());
      if (action === 'products') {
        const products = await fetchProducts();
        return res.status(200).json({
          ok: true,
          products: products.map(p => ({
            id: p.id,
            key: p.key,
            name: p.name,
            description: p.description,
            productType: p.productType,
            purchaseRequirements: p.purchaseRequirements,
            availability: p.availability,
            price: p.price,
            currency: p.currency,
          })),
        });
      }
      return res.status(400).json({ ok: false, error: 'unknown_action' });
    }

    if (req.method === 'POST') {
      return res.status(200).json(await handleAction(req.body || {}));
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('admin_api_error', error?.name || 'Error');
    return res.status(500).json({ ok: false, error: error.message });
  }
}
