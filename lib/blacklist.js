/**
 * Reputation checks (Pro): DNSBLs (zones from env DNSBL_ZONES), abuse.ch Feodo Tracker (CC0) and Tor exits.
 * Spamhaus is deliberately NOT used (its free tier is non-commercial only).
 * The owner must review each DNSBL's terms of use before enabling it.
 */
const { normalizeIp, dnsblName } = require('./ip');
const { withTimeout, feodo, isTorExit, resolver } = require('./net');

const DEFAULT_ZONES = 'bl.spamcop.net,psbl.surriel.com';
const ZONE_INFO = {
  'bl.spamcop.net': { name: 'SpamCop', url: 'https://www.spamcop.net/bl.shtml' },
  'psbl.surriel.com': { name: 'PSBL (Passive Spam Block List)', url: 'https://psbl.org' }
};
function zones() {
  return (process.env.DNSBL_ZONES || DEFAULT_ZONES).split(',').map(s => s.trim().toLowerCase()).filter(z => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(z));
}

/** { listed: true|false|null, detail } — 127.0.0.x answer = listed; NXDOMAIN = not listed; other/timeouts = null. */
async function checkDnsbl(ip, zone) {
  const name = dnsblName(ip, zone);
  const r = resolver();
  const SENTINEL = { timeout: true };
  const res = await withTimeout(r.resolve4(name).then(a => ({ a }), e => ({ err: e.code })), 2000, SENTINEL);
  if (res === SENTINEL) return { listed: null, detail: 'Timed out' };
  if (res.err) {
    if (res.err === 'ENOTFOUND' || res.err === 'ENODATA') return { listed: false, detail: 'Not listed' };
    return { listed: null, detail: 'Lookup failed (' + res.err + ')' };
  }
  const codes = (res.a || []).filter(x => /^127\.0\.0\.\d+$/.test(x));
  if (!codes.length) return { listed: null, detail: 'Unexpected answer (' + (res.a || []).join(', ') + '), the list may be refusing queries from this resolver' };
  const txt = await withTimeout(r.resolveTxt(name), 1500, []);
  const reason = (txt || []).map(t => t.join('')).join(' ').slice(0, 300);
  return { listed: true, detail: 'Listed (' + codes.join(', ') + ')' + (reason ? ': ' + reason : '') };
}

async function blacklist(input) {
  const n = normalizeIp(input);
  if (!n) { const e = new Error('Not a valid IP address'); e.status = 400; throw e; }
  const zs = zones();
  const dnsbl = zs.map(async zone => {
    const info = ZONE_INFO[zone] || { name: zone, url: null };
    if (n.version !== 4) return { source: info.name, zone, url: info.url, listed: null, detail: 'This list only supports IPv4' };
    const r = await checkDnsbl(n.ip, zone);
    return Object.assign({ source: info.name, zone, url: info.url }, r);
  });
  const feodoCheck = (async () => {
    const m = await withTimeout(feodo(), 6000, null);
    if (!m) return { source: 'abuse.ch Feodo Tracker (botnet C2)', url: 'https://feodotracker.abuse.ch', listed: null, detail: 'List temporarily unavailable' };
    const e = m.get(n.ip);
    return { source: 'abuse.ch Feodo Tracker (botnet C2)', url: 'https://feodotracker.abuse.ch', listed: !!e,
      detail: e ? `Botnet C2 server (${e.malware || 'malware'}), status ${e.status || 'unknown'}, last online ${e.last_online || 'n/a'}` : 'Not listed' };
  })();
  const torCheck = (async () => {
    const t = await isTorExit(n.ip);
    return { source: 'Tor Project exit list', url: 'https://check.torproject.org', listed: t, detail: t === null ? 'List temporarily unavailable' : (t ? 'Tor exit node' : 'Not a Tor exit') };
  })();
  const checks = await Promise.all([...dnsbl, feodoCheck, torCheck]);
  return { ip: n.ip, listed: checks.some(c => c.listed === true), checks };
}

module.exports = { blacklist, checkDnsbl, zones };
