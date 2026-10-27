const { test, assert } = require('./_assert');
const { lookupIp, resolveQuery } = require('../lib/lookup');

test('8.8.8.8 → US, AS15169', async () => {
  const r = await lookupIp('8.8.8.8', { rdns: false });
  assert.strictEqual(r.version, 4);
  assert.strictEqual(r.geo.country_code, 'US');
  assert.strictEqual(r.geo.country, 'United States');
  assert.strictEqual(r.asn.number, 15169);
  assert.ok(/google/i.test(r.asn.org));
  assert.strictEqual(r.flags.is_datacenter, true);
});
test('1.1.1.1 → AS13335', async () => {
  const r = await lookupIp('1.1.1.1', { rdns: false });
  assert.strictEqual(r.asn.number, 13335);
  assert.ok(/cloudflare/i.test(r.asn.org));
});
test('2001:4860:4860::8888 → IPv6, AS15169', async () => {
  const r = await lookupIp('2001:4860:4860::8888', { rdns: false });
  assert.strictEqual(r.version, 6);
  assert.strictEqual(r.asn.number, 15169);
  assert.ok(r.geo && r.geo.country_code);
});
test('10.0.0.1 → special (private), no geo', async () => {
  const r = await lookupIp('10.0.0.1');
  assert.strictEqual(r.special.type, 'private');
  assert.strictEqual(r.geo, null);
  assert.strictEqual(r.asn, null);
});
test('invalid IP → error', async () => {
  assert.ok((await lookupIp('300.1.1.1')).error);
});
test('resolveQuery parses IPs, URLs and rejects garbage', async () => {
  assert.deepStrictEqual((await resolveQuery('1.1.1.1:443')).ips, [{ ip: '1.1.1.1', version: 4 }]);
  assert.deepStrictEqual((await resolveQuery('http://[2001:4860:4860::8888]:80/')).ips, [{ ip: '2001:4860:4860::8888', version: 6 }]);
  assert.strictEqual((await resolveQuery('')).status, 400);
  assert.strictEqual((await resolveQuery('not a host!')).status, 400);
});
test('hostname resolution (network)', async () => {
  const r = await resolveQuery('google.com');
  if (r.status === 404) return console.log('       (skipped: no DNS)');
  assert.strictEqual(r.kind, 'host');
  assert.ok(r.ips.length >= 1 && r.ips.length <= 4);
});
test('reverse DNS + RDAP for 8.8.8.8 (network, optional)', async () => {
  const r = await lookupIp('8.8.8.8', { rdap: true });
  if (r.reverse_dns && r.reverse_dns.length) assert.ok(r.reverse_dns.includes('dns.google'));
  if (r.network) assert.strictEqual(r.network.registry, 'ARIN');
  else console.log('       (RDAP unavailable, skipped)');
});
