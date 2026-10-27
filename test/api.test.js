const { test, assert } = require('./_assert');

let n = 0;
function call(mod, { method = 'GET', query = {}, body, ip, host = 'example.vercel.app' } = {}) {
  ip = ip || '203.0.113.' + (++n % 250);
  return new Promise((resolve, reject) => {
    const headers = {}; let status = 200;
    const req = { method, query, body, headers: { 'x-forwarded-for': ip, host }, socket: {} };
    const res = {
      set statusCode(v) { status = v; }, get statusCode() { return status; },
      setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
      end(s) { try { resolve({ status, headers, body: JSON.parse(s) }); } catch (e) { reject(e); } }
    };
    require('../api/' + mod)(req, res).catch(reject);
  });
}

test('lookup: 400 on invalid input, no-store header', async () => {
  const r = await call('lookup', { query: { q: '999.1.1.1 x' } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.error);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
});
test('lookup: special address', async () => {
  const r = await call('lookup', { query: { q: '192.168.1.1' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.results[0].special.type, 'private');
  assert.ok(r.body.attribution.some(a => /DB-IP/.test(a.text)));
});
test('me: x-forwarded-for first entry; debug_ip ignored off localhost', async () => {
  const r = await call('me', { ip: '8.8.8.8, 10.0.0.1', query: { debug_ip: '1.1.1.1' } });
  assert.strictEqual(r.body.ip, '8.8.8.8');
  assert.strictEqual(r.body.result.asn.number, 15169);
});
test('me: debug_ip on localhost', async () => {
  const r = await call('me', { ip: '127.0.0.1', host: 'localhost:5188', query: { debug_ip: '1.1.1.1' } });
  assert.strictEqual(r.body.ip, '1.1.1.1');
});
test('batch: 402 over the free limit without key', async () => {
  const ips = Array.from({ length: 11 }, (_, i) => '8.8.4.' + i);
  const r = await call('batch', { method: 'POST', body: { ips } });
  assert.strictEqual(r.status, 402);
  assert.strictEqual(r.body.upgrade, true);
});
test('batch: free 3 IPs', async () => {
  const r = await call('batch', { method: 'POST', body: { ips: ['8.8.8.8', '1.1.1.1', 'bogus'] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, 3);
  assert.ok(r.body.results[2].error);
  assert.strictEqual(r.body.results[0].network, undefined); // no RDAP in batch
});
test('batch: Pro key (PRO_TEST_KEYS) allows > 10', async () => {
  process.env.PRO_TEST_KEYS = 'TEST-PRO';
  const ips = Array.from({ length: 12 }, (_, i) => '1.0.0.' + (i + 1));
  const r = await call('batch', { method: 'POST', body: { ips, key: 'TEST-PRO' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, 12);
});
test('blacklist: 402 without key', async () => {
  const r = await call('blacklist', { query: { ip: '8.8.8.8' } });
  assert.strictEqual(r.status, 402);
});
test('blacklist: Pro key, test entry 127.0.0.2 is listed (network)', async () => {
  process.env.PRO_TEST_KEYS = 'TEST-PRO';
  const r = await call('blacklist', { query: { ip: '127.0.0.2', key: 'TEST-PRO' } });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.checks) && r.body.checks.length >= 3);
});
test('method not allowed', async () => {
  const r = await call('batch', { method: 'GET' });
  assert.strictEqual(r.status, 405);
});
test('rate limit: 61st request in a minute → 429', async () => {
  let last;
  for (let i = 0; i < 61; i++) last = await call('lookup', { ip: '198.51.100.77', query: { q: '' } });
  assert.strictEqual(last.status, 429);
});
