import http from 'node:http';

const handlers = {
  '/api/telegram': () => import('./api/telegram.js'),
  '/api/catalog': () => import('./api/catalog.js'),
  '/api/admin': () => import('./api/admin.js'),
  '/api/setup': () => import('./api/setup.js'),
  '/api/debug-products': () => import('./api/debug-products.js'),
  '/api/health': () => import('./api/health.js'),
};

function parseQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) return JSON.parse(raw);
  return raw;
}

function decorateResponse(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = value => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = value => {
    if (Buffer.isBuffer(value)) return res.end(value);
    if (typeof value === 'object' && value !== null) return res.json(value);
    res.end(value == null ? '' : String(value));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, nativeRes) => {
  const res = decorateResponse(nativeRes);
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/' || url.pathname === '/health') {
      return res.status(200).json({ ok: true, service: 'cipherforge-arabic-store-bot' });
    }

    const load = handlers[url.pathname];
    if (!load) return res.status(404).json({ ok: false, error: 'not_found' });

    req.query = parseQuery(url);
    req.body = await readBody(req);

    const mod = await load();
    await mod.default(req, res);
    if (!res.writableEnded) res.end();
  } catch (error) {
    console.error('railway_server_error', error);
    if (!res.writableEnded) res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`listening:${port}`);
});
