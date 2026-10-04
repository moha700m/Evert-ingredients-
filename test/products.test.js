import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CANBOSO_API_KEY = 'test-buyer-key';
process.env.CANBOSO_BASE_URL = 'https://supplier.test';
process.env.CANBOSO_AUTH_HEADER = 'x-buyer-key';
process.env.CANBOSO_PRODUCTS_PATH = '/products';
process.env.CANBOSO_PURCHASE_PATH = '/purchase';

const { fetchRawProducts, normalizeProducts, purchaseProduct, canPurchaseWithInput, canAutoPurchase } = await import('../api/_lib/products.js');

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
  const [missingId] = normalizeProducts({ products: [{ name: 'Visible but non-purchasable', price: 5 }] });
  assert.equal(missingId.id, null);
  assert.equal(missingId.sourceIdValid, false);
  const [malformedId] = normalizeProducts({ products: [{ productId: {}, name: 'Visible malformed ID', price: 5 }] });
  assert.equal(malformedId.id, null);
  assert.equal(malformedId.sourceIdValid, false);
  const [badNumeric] = normalizeProducts({ products: [{ productId: 'bad', name: 'Bad stock', price: 'Out of stock: 0', availability: '2 of 10 left' }] });
  assert.equal(badNumeric.price, null);
  assert.equal(badNumeric.availability.available, undefined);
});

test('an ambiguous first POST remains ambiguous when its exact retry is rejected', async () => {
  const product = normalizeProducts({ products: [{ productId: 'retry-id', name: 'Account', price: 2 }] })[0];
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    return new Response(JSON.stringify({ error: 'provider response' }), { status: call === 1 ? 503 : 429 });
  };
  await assert.rejects(purchaseProduct(product, { id: 9 }, 'tg-charge-ambiguous'), error => {
    assert.equal(call, 2);
    assert.equal(error.status, 429);
    assert.equal(error.definitive, false);
    return true;
  });
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

test('follows has_next pagination without a total page count', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return new Response(JSON.stringify({
      products: [{ productId: `cursor-${page}`, name: `Product ${page}`, price: 1 }],
      pagination: { has_next: page < 3 },
    }), { status: 200 });
  };
  const response = await fetchRawProducts();
  assert.equal(calls, 3);
  assert.equal(response.products.length, 3);
});

test('quantity metadata and false optional requirements do not block direct products', () => {
  const [product] = normalizeProducts({ products: [{
    productId: 'quantity-one',
    name: 'Account',
    productType: 'account',
    price: 2,
    purchaseRequirements: { quantityFixed: 1, customerEmail: false },
  }] });
  assert.equal(product.requiresInput, false);
  assert.equal(canAutoPurchase(product), true);
});

test('normalizes JSON and array customer requirements without guessing other fields', () => {
  const products = normalizeProducts({ products: [
    { productId: 'json-req', name: 'YouTube Slot', productType: 'slot', price: 2, purchaseRequirements: '{"customerEmail":true,"quantityFixed":1}' },
    { productId: 'array-req', name: 'YouTube Slot', productType: 'slot', price: 2, purchaseRequirements: ['customerEmail'] },
    { productId: 'other-req', name: 'Manual', productType: 'account', price: 2, purchaseRequirements: ['customerPassword'] },
    { productId: 'unknown-object-req', name: 'Manual', productType: 'account', price: 2, purchaseRequirements: [{}] },
    { productId: 'fixed-three', name: 'Bundle', productType: 'account', price: 2, purchaseRequirements: { quantityFixed: 3 } },
    { productId: 'false-string-req', name: 'Account', productType: 'account', price: 2, purchaseRequirements: 'false' },
    { productId: 'null-string-req', name: 'Account', productType: 'account', price: 2, purchaseRequirements: 'null' },
  ] });
  assert.equal(canPurchaseWithInput(products[0]), true);
  assert.equal(canPurchaseWithInput(products[1]), true);
  assert.equal(canPurchaseWithInput(products[2]), false);
  assert.equal(canAutoPurchase(products[2]), false);
  assert.equal(products[3].requiresInput, true);
  assert.equal(canAutoPurchase(products[3]), false);
  assert.equal(canAutoPurchase(products[4]), false);
  assert.equal(canAutoPurchase(products[5]), true);
  assert.equal(canAutoPurchase(products[6]), true);
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
