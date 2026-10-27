/** Full lookup of one IP (geo + ASN + reverse DNS + optional RDAP + Tor/hosting/VPN heuristics). */
const { normalizeIp, specialRange, cleanHostname } = require('./ip');
const { geo, asn, ATTRIBUTION } = require('./geo');
const { reverseDns, resolveHost, rdap, isTorExit } = require('./net');
const { classify } = require('./classify');

const NO_FLAGS = () => ({ is_tor: false, is_datacenter: false, is_vpn_likely: false, reasons: [] });

/**
 * @param {string} input IP address
 * @param {{rdap?:boolean, rdns?:boolean}} opts
 */
async function lookupIp(input, opts = {}) {
  const n = normalizeIp(input);
  if (!n) return { ip: String(input), error: 'Not a valid IPv4 or IPv6 address' };
  const special = specialRange(n.ip);
  if (special) {
    const f = NO_FLAGS(); f.reasons.push('Special-purpose address: ' + special.label);
    return { ip: n.ip, version: n.version, special, geo: null, asn: null, reverse_dns: [], flags: f };
  }
  const [g, a, rd, tor, network] = await Promise.all([
    geo(n.ip, n.version).catch(() => null),
    asn(n.ip).catch(() => null),
    opts.rdns === false ? Promise.resolve(null) : reverseDns(n.ip),
    isTorExit(n.ip),
    opts.rdap ? rdap(n.ip) : Promise.resolve(undefined)
  ]);
  const flags = classify({ asnOrg: a && a.org, isTor: !!tor, reverseDns: rd || [] });
  if (tor === null) flags.reasons.push('Tor exit list temporarily unavailable');
  const out = { ip: n.ip, version: n.version, geo: g, asn: a, reverse_dns: rd === null ? null : rd, flags };
  if (opts.rdap) out.network = network || null;
  return out;
}

/** Strips "1.2.3.4:443" style ports from IPv4 input. */
function stripV4Port(s) { const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(s); return m ? m[1] : s; }

/**
 * Parse /api/lookup?q= : IP or hostname (URLs are accepted, scheme/path are stripped).
 * @returns {{kind:'ip'|'host', ips:{ip,version}[], host?:string}|{error:string,status:number}}
 */
async function resolveQuery(q) {
  const raw = String(q || '').trim();
  if (!raw) return { error: 'Enter an IP address or a domain name', status: 400 };
  if (raw.length > 300) return { error: 'Input is too long', status: 400 };
  let s = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  const bracket = /^\[([0-9a-f:.]+)\](?::\d+)?$/i.exec(s); if (bracket) s = bracket[1];
  const ip = normalizeIp(stripV4Port(s));
  if (ip) return { kind: 'ip', ips: [ip] };
  const host = cleanHostname(raw);
  if (!host) return { error: 'Not a valid IP address or domain name', status: 400 };
  const ips = await resolveHost(host, 4);
  if (!ips.length) return { error: `Could not resolve "${host}" (no A or AAAA records)`, status: 404 };
  return { kind: 'host', host, ips };
}

function attribution(withRdap) {
  return withRdap ? ATTRIBUTION.concat([{ text: 'Network registration via RDAP (rdap.org → regional Internet registry)', url: 'https://rdap.org' }]) : ATTRIBUTION.slice();
}

module.exports = { lookupIp, resolveQuery, attribution };
