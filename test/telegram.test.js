import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
process.env.TELEGRAM_ADMIN_ID = '999';
process.env.WEBHOOK_SECRET = 'webhook-test-secret';
process.env.SETUP_SECRET = 'setup-test-secret';
process.env.PUBLIC_BASE_URL = 'https://store.example';
process.env.CONTROL_PANEL_CONFIG_URL = 'https://control.example/api/public-config';
process.env.CANBOSO_API_KEY = 'test-buyer-key';
process.env.CANBOSO_BASE_URL = 'https://supplier.test';
process.env.CANBOSO_AUTH_HEADER = 'x-buyer-key';
process.env.CANBOSO_PRODUCTS_PATH = '/products';
process.env.CANBOSO_PURCHASE_PATH = '/purchase';
process.env.STAR_RATE = '100';
process.env.MARKUP_PERCENT = '25';

const { default: webhook } = await import('../api/telegram.js');
const { default: health } = await import('../api/health.js');

const productRows = [
  { productId: 'apple-id-1', name: 'Apple ID 2FA 6 Months', description: 'Supplier Apple description, preserved as provided.', productType: 'account', price: { amount: 1.001, currency: 'USD' }, availability: { available: '20' } },
  { productId: 'direct-1', name: 'ChatGPT Account 1 Month', description: 'Real direct product description.', productType: 'account', price: { amount: 1.001, currency: 'USD' }, availability: { available: 20 } },
  { productId: 'youtube-slot', name: 'YouTube Premium Slot 1 Month', description: 'Supplier slot description.', productType: 'slot', price: { amount: 1.001, currency: 'USD' }, availability: { available: 20 }, purchaseRequirements: { customerEmail: true, quantityFixed: 1 } },
  { productId: 'sold-out', name: 'Canva 1 Month', description: 'Out of stock product.', productType: 'account', price: 1, availability: { available: '0' } },
];
let products = productRows;
let telegramCalls = [];
let supplierPurchases = [];
let purchaseResponses = [];
let failCustomerDelivery = false;
let failAdminNoticeOnce = false;
let failRefundOnce = false;
let webhookUrl = 'https://old.example/api/telegram';

function telegramCall(method, body) {
  telegramCalls.push({ method, body });
  if (method === 'setWebhook') webhookUrl = body.url;
  if (method === 'sendMessage' && failCustomerDelivery && body.text?.startsWith('✅ تم طلبك بنجاح')) {
    failCustomerDelivery = false;
    return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'temporary send failure' }), { status: 400 });
  }
  if (method === 'sendMessage' && failAdminNoticeOnce && String(body.chat_id) === '999' && body.text?.startsWith('🚨')) {
    failAdminNoticeOnce = false;
    return new Response(JSON.stringify({ ok: false, error_code: 503, description: 'temporary admin alert failure' }), { status: 503 });
  }
  if (method === 'refundStarPayment' && failRefundOnce) {
    failRefundOnce = false;
    return new Response(JSON.stringify({ ok: false, error_code: 503, description: 'temporary refund failure' }), { status: 503 });
  }
  if (method === 'sendInvoice') return ok({ message_id: telegramCalls.length, invoice: true });
  if (method === 'getMe') return ok({ id: 123456, username: 'StoreBot', first_name: 'Store' });
  if (method === 'getWebhookInfo') return ok({ url: webhookUrl, pending_update_count: 0 });
  if (method === 'getMyCommands') return ok([]);
  return ok({ message_id: telegramCalls.length, chat: { id: body.chat_id, type: 'private' } });
}

function ok(result) {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://api.telegram.org/')) {
      const method = new URL(url).pathname.split('/').at(-1);
      return telegramCall(method, JSON.parse(init.body || '{}'));
    }
    if (url === process.env.CONTROL_PANEL_CONFIG_URL) {
      return new Response(JSON.stringify({ ok: true, settings: { livePurchases: true, markupPercent: 25, starRate: 100, productsPageSize: 8 } }), { status: 200 });
    }
    if (url.startsWith('https://supplier.test/products')) {
      return new Response(JSON.stringify({ success: true, products }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://supplier.test/purchase')) {
      supplierPurchases.push({ headers: init.headers, body: init.body });
      const response = purchaseResponses.length ? purchaseResponses.shift() : { status: 200, body: { success: true, order: { orderCode: 'ORDER-1', productName: 'ChatGPT Account', status: 'completed', quantity: 1 }, delivery: { accounts: [{ user: 'buyer-user', password: 'delivery-password' }] } } };
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected mocked URL: ${url}`);
  };
}

afterEach(() => {
  globalThis.fetch = undefined;
  telegramCalls = [];
  supplierPurchases = [];
  purchaseResponses = [];
  failCustomerDelivery = false;
  failAdminNoticeOnce = false;
  failRefundOnce = false;
  products = productRows;
  webhookUrl = 'https://old.example/api/telegram';
});

function response() {
  return {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
    send(body) { this.body = body; return this; },
  };
}

async function callWebhook(update) {
  const res = response();
  await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': process.env.WEBHOOK_SECRET }, body: update }, res);
  return res;
}

const user = { id: 777, username: 'buyer' };
const chat = { id: 777, type: 'private' };
const productKey = id => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);

function callback(data) {
  return { callback_query: { id: `query-${Date.now()}-${Math.random()}`, from: user, data, message: { chat } } };
}

test('keeps /start and browsing native, with Apple first and source product text', async () => {
  installFetch();
  const start = await callWebhook({ message: { text: '/start', from: user, chat } });
  assert.equal(start.code, 200);
  assert.ok(telegramCalls.some(call => call.method === 'setChatMenuButton' && call.body.menu_button.type === 'default'));
  assert.equal(telegramCalls.some(call => call.body?.menu_button?.type === 'web_app'), false);
  const categories = telegramCalls.find(call => call.method === 'sendMessage' && call.body.reply_markup?.inline_keyboard);
  assert.equal(categories.body.reply_markup.inline_keyboard[0][0].text, '🍎 Apple');

  telegramCalls = [];
  await callWebhook(callback('cat:apple'));
  const productGrid = telegramCalls.find(call => call.method === 'sendMessage' && call.body.reply_markup?.inline_keyboard);
  assert.match(productGrid.body.reply_markup.inline_keyboard[0][0].text, /^🍎 Apple ID 2FA/);
  await callWebhook(callback(`p:${productKey('apple-id-1')}`));
  const details = telegramCalls.findLast(call => call.method === 'sendMessage');
  assert.match(details.body.text, /Apple ID 2FA 6 Months/);
  assert.match(details.body.text, /Supplier Apple description, preserved as provided\./);
  assert.match(details.body.text, /المتاح: 20/);
});

test('ForceReply account flow creates one independent Stars invoice per requested account', async () => {
  installFetch();
  for (const count of [1, 2, 3]) {
    telegramCalls = [];
    await callWebhook(callback(`form:${productKey('youtube-slot')}:${count}`));
    let prompt = telegramCalls.findLast(call => call.method === 'sendMessage' && call.body.reply_markup?.force_reply);
    assert.ok(prompt);
    for (let index = 1; index <= count; index += 1) {
      await callWebhook({ message: {
        message_id: 1000 + index,
        text: `buyer${count}${index}@example.com`,
        from: user,
        chat,
        reply_to_message: { from: { id: 123456, is_bot: true }, text: prompt.body.text },
      } });
      prompt = telegramCalls.findLast(call => call.method === 'sendMessage' && call.body.reply_markup?.force_reply);
    }
    const invoices = telegramCalls.filter(call => call.method === 'sendInvoice');
    assert.equal(invoices.length, count);
    assert.ok(invoices.every(invoice => invoice.body.currency === 'XTR'));
    assert.ok(invoices.every(invoice => Buffer.byteLength(invoice.body.payload, 'utf8') <= 128));
    const invoiceEmails = invoices.map(invoice => decodeURIComponent(invoice.body.payload.split(':').at(-1)));
    assert.deepEqual(invoiceEmails.sort(), Array.from({ length: count }, (_, index) => `buyer${count}${index + 1}@example.com`).sort());
  }
});

test('rechecks stock on an old ForceReply before issuing email invoices', async () => {
  installFetch();
  await callWebhook(callback(`form:${productKey('youtube-slot')}:1`));
  const prompt = telegramCalls.findLast(call => call.method === 'sendMessage' && call.body.reply_markup?.force_reply);
  products = productRows.map(product => product.productId === 'youtube-slot'
    ? { ...product, availability: { available: '0' } }
    : product);
  await callWebhook({ message: {
    message_id: 2077,
    text: 'buyer@example.com',
    from: user,
    chat,
    reply_to_message: { from: { id: 123456, is_bot: true }, text: prompt.body.text },
  } });
  assert.equal(telegramCalls.filter(call => call.method === 'sendInvoice').length, 0);
  assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && /مو متوفرة حالياً/.test(call.body.text)));
});

test('three paid email invoices make three separate quantity-one supplier orders', async () => {
  installFetch();
  await callWebhook(callback(`form:${productKey('youtube-slot')}:3`));
  let prompt = telegramCalls.findLast(call => call.method === 'sendMessage' && call.body.reply_markup?.force_reply);
  for (let index = 1; index <= 3; index += 1) {
    await callWebhook({ message: {
      message_id: 3000 + index,
      text: `three${index}@example.com`,
      from: user,
      chat,
      reply_to_message: { from: { id: 123456, is_bot: true }, text: prompt.body.text },
    } });
    prompt = telegramCalls.findLast(call => call.method === 'sendMessage' && call.body.reply_markup?.force_reply);
  }
  const invoices = telegramCalls.filter(call => call.method === 'sendInvoice');
  assert.equal(invoices.length, 3);
  for (const [index, invoice] of invoices.entries()) {
    const email = decodeURIComponent(invoice.body.payload.split(':').at(-1));
    await callWebhook({ message: {
      successful_payment: { currency: 'XTR', total_amount: invoice.body.prices[0].amount, invoice_payload: invoice.body.payload, telegram_payment_charge_id: `charge-slot-${index + 1}` },
      from: user,
      chat,
    } });
    const request = supplierPurchases[index];
    assert.equal(JSON.parse(request.body).customer_email, email);
    assert.equal(JSON.parse(request.body).quantity, 1);
  }
  assert.equal(supplierPurchases.length, 3);
  assert.equal(new Set(supplierPurchases.map(call => call.headers['Idempotency-Key'])).size, 3);
});

test('precheckout rejects a supplier price change even when the rounded Stars amount is unchanged', async () => {
  installFetch();
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  const invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  assert.equal(invoice.prices[0].amount, 126);
  products = productRows.map(product => product.productId === 'direct-1'
    ? { ...product, price: { amount: 1.002, currency: 'USD' } }
    : product);
  await callWebhook({ pre_checkout_query: { id: 'pre-1', invoice_payload: invoice.payload, total_amount: invoice.prices[0].amount, currency: 'XTR' } });
  const answer = telegramCalls.findLast(call => call.method === 'answerPreCheckoutQuery');
  assert.equal(answer.body.ok, false);
  assert.match(answer.body.error_message, /السعر أو التوفر تغيّر/);
});

test('precheckout accepts a current invoice and rejects mismatched amount or currency', async () => {
  installFetch();
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  const invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  const base = { id: 'pre-valid', invoice_payload: invoice.payload, total_amount: invoice.prices[0].amount, currency: 'XTR' };
  await callWebhook({ pre_checkout_query: base });
  assert.equal(telegramCalls.findLast(call => call.method === 'answerPreCheckoutQuery').body.ok, true);
  await callWebhook({ pre_checkout_query: { ...base, id: 'pre-amount', total_amount: base.total_amount + 1 } });
  assert.equal(telegramCalls.findLast(call => call.method === 'answerPreCheckoutQuery').body.ok, false);
  await callWebhook({ pre_checkout_query: { ...base, id: 'pre-currency', currency: 'USD' } });
  assert.equal(telegramCalls.findLast(call => call.method === 'answerPreCheckoutQuery').body.ok, false);
  products = productRows.map(product => product.productId === 'direct-1'
    ? { ...product, availability: { available: '0' } }
    : product);
  await callWebhook({ pre_checkout_query: { ...base, id: 'pre-stock' } });
  assert.equal(telegramCalls.findLast(call => call.method === 'answerPreCheckoutQuery').body.ok, false);
});

test('supplier success followed by Telegram delivery failure retries delivery without a second purchase or refund', async () => {
  installFetch();
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  const invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  const payment = { currency: 'XTR', total_amount: invoice.prices[0].amount, invoice_payload: invoice.payload, telegram_payment_charge_id: 'charge-delivery-retry' };
  failCustomerDelivery = true;
  const first = await callWebhook({ message: { successful_payment: payment, from: user, chat } });
  assert.equal(first.code, 500, JSON.stringify({ failCustomerDelivery, supplierPurchases, telegramCalls: telegramCalls.map(call => ({ method: call.method, text: call.body.text })) }));
  assert.equal(supplierPurchases.length, 1);
  assert.equal(telegramCalls.filter(call => call.method === 'refundStarPayment').length, 0);
  const second = await callWebhook({ message: { successful_payment: payment, from: user, chat } });
  assert.equal(second.code, 200);
  assert.equal(supplierPurchases.length, 1);
  assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.text?.includes('delivery-password')));
});

test('definitive supplier rejection refunds; ambiguous failure after retry does not', async () => {
  installFetch();
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  let invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  purchaseResponses = [{ status: 400, body: { success: false, error: 'rejected' } }];
  await callWebhook({ message: { successful_payment: { currency: 'XTR', total_amount: 126, invoice_payload: invoice.payload, telegram_payment_charge_id: 'charge-definite' }, from: user, chat } });
  assert.equal(telegramCalls.filter(call => call.method === 'refundStarPayment').length, 1);

  telegramCalls = [];
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  purchaseResponses = [
    { status: 503, body: { success: false, error: 'uncertain' } },
    { status: 429, body: { success: false, error: 'rate limited' } },
  ];
  await callWebhook({ message: { successful_payment: { currency: 'XTR', total_amount: 126, invoice_payload: invoice.payload, telegram_payment_charge_id: 'charge-ambiguous' }, from: user, chat } });
  assert.equal(telegramCalls.filter(call => call.method === 'refundStarPayment').length, 0);
  assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.chat_id === '999' && /charge-ambiguous/.test(call.body.text)));
  assert.equal(supplierPurchases.length, 3);
});

test('failed reconciliation and refund-failure alerts retry notices only', async () => {
  installFetch();
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  const invoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  const changedPayment = { currency: 'XTR', total_amount: 126, invoice_payload: invoice.payload, telegram_payment_charge_id: 'charge-review-notice' };
  products = productRows.map(product => product.productId === 'direct-1'
    ? { ...product, price: { amount: 1.002, currency: 'USD' } }
    : product);
  failAdminNoticeOnce = true;
  const firstReview = await callWebhook({ message: { successful_payment: changedPayment, from: user, chat } });
  assert.equal(firstReview.code, 500);
  const secondReview = await callWebhook({ message: { successful_payment: changedPayment, from: user, chat } });
  assert.equal(secondReview.code, 200);
  assert.equal(supplierPurchases.length, 0);
  assert.equal(telegramCalls.filter(call => call.method === 'refundStarPayment').length, 0);

  products = productRows;
  telegramCalls = [];
  await callWebhook(callback(`buy:${productKey('direct-1')}`));
  const nextInvoice = telegramCalls.find(call => call.method === 'sendInvoice').body;
  purchaseResponses = [{ status: 400, body: { success: false, error: 'rejected' } }];
  failRefundOnce = true;
  failAdminNoticeOnce = true;
  const failedRefundPayment = { currency: 'XTR', total_amount: 126, invoice_payload: nextInvoice.payload, telegram_payment_charge_id: 'charge-refund-alert' };
  const firstRefund = await callWebhook({ message: { successful_payment: failedRefundPayment, from: user, chat } });
  assert.equal(firstRefund.code, 500);
  const secondRefund = await callWebhook({ message: { successful_payment: failedRefundPayment, from: user, chat } });
  assert.equal(secondRefund.code, 200);
  assert.equal(telegramCalls.filter(call => call.method === 'refundStarPayment').length, 1);
  assert.equal(supplierPurchases.length, 1);
  assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.chat_id === '999' && /charge-refund-alert/.test(call.body.text)));
});

test('health checks are read-only by default and repairs only the configured production webhook with the secret', async () => {
  installFetch();
  const run = async query => {
    const res = response();
    await health({ method: 'GET', headers: { host: 'attacker.example' }, query }, res);
    return res;
  };
  const read = await run({});
  assert.equal(read.code, 200);
  assert.equal(read.body.webhook.matchesProductionUrl, false);
  assert.equal(telegramCalls.some(call => call.method === 'setWebhook'), false);
  const denied = await run({ repair: '1' });
  assert.equal(denied.code, 401);
  const repaired = await run({ repair: '1', secret: process.env.SETUP_SECRET });
  assert.equal(repaired.code, 200);
  assert.equal(webhookUrl, 'https://store.example/api/telegram');
  assert.equal(telegramCalls.findLast(call => call.method === 'setWebhook').body.drop_pending_updates, false);
});
