const { test, assert } = require('./_assert');
const { classify } = require('../lib/classify');

test('datacenter heuristics', () => {
  for (const org of ['Google LLC', 'Cloudflare, Inc.', 'Amazon.com, Inc.', 'DIGITALOCEAN-ASN', 'Hetzner Online GmbH', 'OVH SAS', 'Microsoft Corporation'])
    assert.strictEqual(classify({ asnOrg: org }).is_datacenter, true, org);
});
test('VPN heuristics', () => {
  for (const org of ['Tefincom S.A.', 'M247 Europe SRL', 'Mullvad VPN AB', 'Datacamp Limited', 'Proton AG', 'Packethub S.A.'])
    assert.strictEqual(classify({ asnOrg: org }).is_vpn_likely, true, org);
  assert.strictEqual(classify({ asnOrg: 'Hetzner Online GmbH', reverseDns: ['vpn-de-12.example.net'] }).is_vpn_likely, true);
});
test('residential ISPs are not flagged', () => {
  for (const org of ['Comcast Cable Communications, LLC', 'Telecom Argentina S.A.', 'Deutsche Telekom AG', 'Google Fiber Inc.', 'Laura Telecom']) {
    const r = classify({ asnOrg: org });
    assert.strictEqual(r.is_datacenter || r.is_vpn_likely, false, org);
    assert.ok(r.reasons.length);
  }
});
test('Tor flag', () => {
  const r = classify({ asnOrg: 'Some ISP', isTor: true });
  assert.strictEqual(r.is_tor, true);
  assert.ok(r.reasons[0].includes('Tor'));
});
