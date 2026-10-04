import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CANBOSO_API_KEY = 'test-buyer-key';
process.env.CANBOSO_BASE_URL = 'https://supplier.test';
process.env.CANBOSO_AUTH_HEADER = 'x-buyer-key';
process.env.CANBOSO_PRODUCTS_PATH = '/products';
process.env.CANBOSO_PURCHASE_PATH = '/purchase';

const { fetchRawProducts, normalizeProducts, purchaseProduct, canPurchaseWithInput } = await import('../api/_lib/products.js');

afterEach(() => { globalThis.fetch = undefined; });

test('normalizes stable supplier IDs, numeric stock, and unknown stock', () => {
  const products = normalizeProducts({ products: [
    { productId: 'apple-1', name: 'Apple ID', price: { amount: 10, currency: 'USD' }, availability: { available: '2' } },
    { product_id: 'mail-1', name: 'Mail', price: '4.5', availability: { available: null } },
    { productId: 'apple-1', name: 'Duplicate', price: 10 },
  ] });
  assert.equal(products.length, 2);
  assert.equal(products[0].id, 'apple-1');
  assert.equal(products[0].availability.available, 2);
  assert.notEqual(typeof products[1].availability.available, 'number');
  assert.equal(products[1].price, 4.5);
});

test('follows all supplier pages beyond the old twenty-page ceiling', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return new Response(JSON.stringify({
      success: true,
      products: [{ productId: `supplier-${page}`, name: `Product ${page}`, price: 1 }],
      pagination: { page, total_pages: 21 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const response = await fetchRawProducts();
  assert.equal(calls, 21);
  assert.equal(response.products.length, 21);
  assert.equal(response.products.at(-1).productId, 'supplier-21');
});

test('rejects HTTP 200 success:false without retaining raw supplier content', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'private-secret-payload' }), { status: 200 });
  await assert.rejects(fetchRawProducts(), error => {
    assert.equal(error.status, 200);
    assert.equal(error.message.includes('private-secret-payload'), false);
    return true;
  });
});

test('purchases slot input with supplier field names and exact idempotent retry body', async () => {
  const product = normalizeProducts({ products: [{
    productId: 'real-slot-id',
    name: 'YouTube Slot',
    productType: 'slot',
    price: 20,
    purchaseRequirements: { customerEmail: true, quantityFixed: 1 },
  }] })[0];
  assert.equal(canPurchaseWithInput(product), true);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: init.body });
    if (requests.length === 1) return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
    return new Response(JSON.stringify({ success: true, order: { orderCode: 'ORDER123' } }), { status: 200 });
  };
  const result = await purchaseProduct(product, { id: 7 }, 'tg-charge-test-123', { customerEmail: 'buyer@example.com' });
  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Idempotency-Key'], 'tg-charge-test-123');
  assert.equal(requests[1].headers['Idempotency-Key'], 'tg-charge-test-123');
  assert.equal(requests[0].body, requests[1].body);
  const sent = JSON.parse(requests[0].body);
  assert.equal(sent.product_id, 'real-slot-id');
  assert.equal(sent.quantity, 1);
  assert.equal(sent.customer_email, 'buyer@example.com');
  assert.equal('customerEmail' in sent, false);
});
