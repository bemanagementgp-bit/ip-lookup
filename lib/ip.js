/** IP parsing, normalisation, special-purpose ranges and DNSBL name building. No dependencies. */
const net = require('net');

/** IPv4 dotted string -> BigInt */
function v4ToBig(ip) {
  return ip.split('.').reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n);
}

/** IPv6 string (any valid form, incl. embedded IPv4) -> BigInt */
function v6ToBig(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  // embedded IPv4 tail (::ffff:1.2.3.4)
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = v4ToBig(m[1]);
    s = s.slice(0, -m[1].length) + (n >> 16n).toString(16) + ':' + (n & 0xffffn).toString(16);
  }
  let parts;
  if (s.includes('::')) {
    const [l, r] = s.split('::');
    const L = l ? l.split(':') : [], R = r ? r.split(':') : [];
    parts = L.concat(Array(8 - L.length - R.length).fill('0'), R);
  } else parts = s.split(':');
  return parts.reduce((a, h) => (a << 16n) + BigInt(parseInt(h || '0', 16)), 0n);
}

/** BigInt -> compressed IPv6 (RFC 5952) */
function bigToV6(n) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
  let bs = -1, bl = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i; while (j < 8 && g[j] === 0) j++;
    if (j - i > bl && j - i > 1) { bs = i; bl = j - i; }
    i = j;
  }
  const h = g.map(x => x.toString(16));
  if (bs < 0) return h.join(':');
  return h.slice(0, bs).join(':') + '::' + h.slice(bs + bl).join(':');
}

/**
 * Validate + normalise user input. Accepts brackets ("[::1]"), zone ids are stripped,
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) is converted to plain IPv4.
 * Returns { ip, version } or null.
 */
function normalizeIp(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/^\[|\]$/g, '').replace(/%[\w.-]+$/, '');
  if (!s || s.length > 64) return null;
  const v = net.isIP(s);
  if (v === 4) {
    // reject leading zeros ambiguity (net.isIP already rejects octal-looking values in modern Node)
    return { ip: s.split('.').map(Number).join('.'), version: 4 };
  }
  if (v === 6) {
    const n = v6ToBig(s);
    if ((n >> 32n) === 0xffffn) { // ::ffff:0:0/96 IPv4-mapped
      const x = Number(n & 0xffffffffn);
      return { ip: [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.'), version: 4 };
    }
    return { ip: bigToV6(n), version: 6 };
  }
  return null;
}

function cidr(str) {
  const [a, p] = str.split('/');
  const version = net.isIP(a);
  const bits = version === 4 ? 32 : 128;
  const base = version === 4 ? v4ToBig(a) : v6ToBig(a);
  const prefix = Number(p);
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { version, base: base & mask, mask, str };
}

// Order matters: first match wins (most specific first).
const SPECIAL = [
  ['0.0.0.0/8', 'unspecified', '"This network"', 'Addresses in 0.0.0.0/8 mean "this host on this network" and are only valid as a source while a device is booting. They are never routed on the Internet.'],
  ['10.0.0.0/8', 'private', 'Private network (RFC 1918)', 'This is a private address used inside homes, offices and data centers. It is not reachable from the Internet and is reused by millions of networks, so it has no public location or owner. Your router translates it to a public IP (NAT).'],
  ['100.64.0.0/10', 'cgnat', 'Carrier-grade NAT (RFC 6598)', 'Shared address space used by Internet providers behind carrier-grade NAT. Many customers share one public IP, so this address has no public location. Your public IP is the one the provider translates it to.'],
  ['127.0.0.0/8', 'loopback', 'Loopback (localhost)', 'Loopback addresses always point to the device itself (127.0.0.1 is "localhost"). Traffic never leaves the machine.'],
  ['169.254.0.0/16', 'link-local', 'Link-local (APIPA)', 'Self-assigned link-local address. A device picks one when it cannot reach a DHCP server. It only works on the local network segment and usually indicates a connection problem.'],
  ['172.16.0.0/12', 'private', 'Private network (RFC 1918)', 'This is a private address (172.16.0.0 – 172.31.255.255) used inside local networks and container platforms such as Docker. It is not reachable from the Internet and has no public location.'],
  ['192.0.0.0/24', 'reserved', 'IETF protocol assignments', 'Reserved by the IETF for special protocol use (RFC 6890). Not routed on the public Internet.'],
  ['192.0.2.0/24', 'documentation', 'Documentation (TEST-NET-1)', 'Reserved for examples in documentation and books (RFC 5737). It is never assigned to a real network.'],
  ['192.88.99.0/24', 'reserved', 'Deprecated 6to4 relay anycast', 'Formerly used for 6to4 relay routers (RFC 3068, deprecated by RFC 7526).'],
  ['192.168.0.0/16', 'private', 'Private network (RFC 1918)', 'This is a private address, the range most home routers use (e.g. 192.168.0.1 or 192.168.1.1). It only exists inside your local network, is not reachable from the Internet and has no public location.'],
  ['198.18.0.0/15', 'reserved', 'Benchmarking (RFC 2544)', 'Reserved for network device benchmarking tests. Not used on the public Internet.'],
  ['198.51.100.0/24', 'documentation', 'Documentation (TEST-NET-2)', 'Reserved for examples in documentation (RFC 5737). It is never assigned to a real network.'],
  ['203.0.113.0/24', 'documentation', 'Documentation (TEST-NET-3)', 'Reserved for examples in documentation (RFC 5737). It is never assigned to a real network.'],
  ['224.0.0.0/4', 'multicast', 'Multicast', 'Multicast addresses identify a group of receivers (e.g. streaming, routing protocols), not a single device, so they have no location.'],
  ['255.255.255.255/32', 'broadcast', 'Limited broadcast', 'The limited broadcast address reaches every device on the local network segment. It is never routed.'],
  ['240.0.0.0/4', 'reserved', 'Reserved (Class E)', 'Reserved for future use since the 1980s (RFC 1112). Not assigned or routed on the Internet.'],
  ['::/128', 'unspecified', 'Unspecified address', 'The IPv6 unspecified address (::) means "no address". It is only used as a source address before a device has one.'],
  ['::1/128', 'loopback', 'Loopback (localhost)', 'The IPv6 loopback address (::1) always points to the device itself.'],
  ['100::/64', 'reserved', 'Discard prefix (RFC 6666)', 'Used to blackhole unwanted traffic. Not a real host.'],
  ['2001:db8::/32', 'documentation', 'Documentation (RFC 3849)', 'Reserved for examples in documentation. It is never assigned to a real network.'],
  ['fc00::/7', 'private', 'Unique local address (ULA)', 'IPv6 unique local addresses (fc00::/7, usually fd00::/8) are the IPv6 equivalent of private ranges. They only work inside an organisation and have no public location.'],
  ['fe80::/10', 'link-local', 'Link-local', 'Every IPv6 interface has a link-local address (fe80::/10). It only works on the local network segment and is never routed.'],
  ['ff00::/8', 'multicast', 'Multicast', 'IPv6 multicast addresses identify a group of receivers (ff02::1 = all nodes on the link), not a single device.'],
  ['::/3', 'reserved', 'Reserved IPv6 space', 'This address is outside 2000::/3, the only IPv6 space currently allocated for global unicast. It is not a public Internet address.'],
  ['4000::/2', 'reserved', 'Reserved IPv6 space', 'This address is outside 2000::/3, the only IPv6 space currently allocated for global unicast. It is not a public Internet address.'],
  ['8000::/1', 'reserved', 'Reserved IPv6 space', 'This address is outside 2000::/3, the only IPv6 space currently allocated for global unicast. It is not a public Internet address.']
].map(([c, type, label, description]) => Object.assign(cidr(c), { type, label, description }));

/** Returns { type, label, description, range } for special-purpose addresses, else null. */
function specialRange(ip) {
  const n = normalizeIp(ip); if (!n) return null;
  const big = n.version === 4 ? v4ToBig(n.ip) : v6ToBig(n.ip);
  for (const r of SPECIAL) {
    if (r.version !== n.version) continue;
    if ((big & r.mask) === r.base) return { type: r.type, label: r.label, description: r.description, range: r.str };
  }
  return null;
}

/** DNSBL query name: 1.2.3.4 + zone -> 4.3.2.1.zone ; IPv6 -> nibble format */
function dnsblName(ip, zone) {
  const n = normalizeIp(ip); if (!n) return null;
  if (n.version === 4) return n.ip.split('.').reverse().join('.') + '.' + zone;
  const hex = v6ToBig(n.ip).toString(16).padStart(32, '0');
  return hex.split('').reverse().join('.') + '.' + zone;
}

/** Hostname check (also strips scheme/path/port from pasted URLs). Returns cleaned host or null. */
function cleanHostname(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s || s.length > 253) return null;
  if (!/^(?=.{1,253}$)(?!-)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(s)) return null;
  return s;
}

module.exports = { normalizeIp, specialRange, dnsblName, cleanHostname, v4ToBig, v6ToBig, bigToV6 };
