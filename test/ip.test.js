const { test, assert } = require('./_assert');
const { normalizeIp, specialRange, dnsblName, cleanHostname } = require('../lib/ip');

test('normalizeIp v4/v6/mapped/brackets/invalid', () => {
  assert.deepStrictEqual(normalizeIp(' 8.8.8.8 '), { ip: '8.8.8.8', version: 4 });
  assert.deepStrictEqual(normalizeIp('2001:4860:4860:0:0:0:0:8888'), { ip: '2001:4860:4860::8888', version: 6 });
  assert.deepStrictEqual(normalizeIp('[::1]'), { ip: '::1', version: 6 });
  assert.deepStrictEqual(normalizeIp('::ffff:1.2.3.4'), { ip: '1.2.3.4', version: 4 });
  for (const bad of ['', '999.1.1.1', '1.2.3', 'google.com', '1.2.3.4.5', ':::', null]) assert.strictEqual(normalizeIp(bad), null, String(bad));
});

test('special ranges', () => {
  const t = ip => (specialRange(ip) || {}).type || null;
  const cases = {
    '10.0.0.1': 'private', '172.16.5.4': 'private', '172.32.0.1': null, '192.168.1.1': 'private',
    '127.0.0.1': 'loopback', '169.254.10.10': 'link-local', '100.64.0.1': 'cgnat', '100.128.0.1': null,
    '224.0.0.251': 'multicast', '192.0.2.10': 'documentation', '198.51.100.1': 'documentation', '203.0.113.7': 'documentation',
    '240.0.0.1': 'reserved', '255.255.255.255': 'broadcast', '0.1.2.3': 'unspecified',
    '::1': 'loopback', '::': 'unspecified', 'fd12:3456::1': 'private', 'fe80::1': 'link-local', 'ff02::1': 'multicast',
    '2001:db8::1': 'documentation', '::ffff:10.1.1.1': 'private',
    '8.8.8.8': null, '1.1.1.1': null, '2001:4860:4860::8888': null, '2606:4700:4700::1111': null
  };
  for (const [ip, type] of Object.entries(cases)) assert.strictEqual(t(ip), type, ip);
});

test('DNSBL query names', () => {
  assert.strictEqual(dnsblName('1.2.3.4', 'bl.spamcop.net'), '4.3.2.1.bl.spamcop.net');
  assert.strictEqual(dnsblName('127.0.0.2', 'psbl.surriel.com'), '2.0.0.127.psbl.surriel.com');
  assert.strictEqual(dnsblName('2001:db8::1', 'x.org'), '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.x.org');
  assert.strictEqual(dnsblName('nope', 'x.org'), null);
});

test('hostname cleaning', () => {
  assert.strictEqual(cleanHostname('Google.com'), 'google.com');
  assert.strictEqual(cleanHostname('https://www.example.com/path?x=1'), 'www.example.com');
  assert.strictEqual(cleanHostname('example.com:8080'), 'example.com');
  assert.strictEqual(cleanHostname('localhost'), null);
  assert.strictEqual(cleanHostname('bad host.com'), null);
  assert.strictEqual(cleanHostname('-x.com'), null);
});
