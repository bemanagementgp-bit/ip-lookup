/**
 * HEURISTIC hosting / VPN classification from the ASN organisation name (and optional reverse DNS).
 * These are "likely" signals only: a datacenter ASN can also serve business customers, and many VPNs
 * rent space from generic hosting providers. Never present the result as certain.
 */
const DATACENTER = [
  'amazon', 'aws', 'google', 'microsoft', 'azure', 'digitalocean', 'ovh', 'hetzner', 'linode', 'akamai',
  'vultr', 'choopa', 'contabo', 'oracle', 'alibaba', 'aliyun', 'tencent', 'scaleway', 'online s.a.s', 'leaseweb',
  'cloudflare', 'fastly', 'ionos', '1&1', 'hostinger', 'godaddy', 'hostgator', 'bluehost', 'unified layer',
  'rackspace', 'softlayer', 'ibm cloud', 'equinix', 'kamatera', 'hostwinds', 'interserver', 'dreamhost',
  'a2 hosting', 'liquid web', 'namecheap', 'netcup', 'ionos', 'strato', 'upcloud', 'hivelocity', 'psychz',
  'quadranet', 'colocrossing', 'buyvm', 'frantech', 'serverius', 'worldstream', 'nforce', 'g-core', 'gcore',
  'selectel', 'timeweb', 'beget', 'reg.ru', 'servers.com', 'cherry servers', 'heficed', 'datapacket', 'cdn77',
  'stackpath', 'limelight', 'edgio', 'incapsula', 'imperva', 'sucuri', 'hosting', 'datacenter', 'data center',
  'colocation', 'cloud', 'server', 'vps', 'dedicated'
];
const VPN = [
  'nordvpn', 'tefincom', 'mullvad', 'express technologies', 'expressvpn', 'surfshark', 'proton', 'private internet access',
  'pia', 'ipvanish', 'windscribe', 'hide.me', 'cyberghost', 'kape', 'm247', 'datacamp', 'cdn77', 'packethub',
  'zenlayer', 'hidemyass', 'purevpn', 'gz systems', 'torguard', 'vyprvpn', 'golden frog', 'astrill', 'airvpn',
  'ivpn', 'privado', 'tunnelbear', 'hotspot shield', 'aura', 'pango', 'strong technology', 'anchorfree',
  'performive', 'tzulo', 'xtom', 'clouvider', '31173 services', 'obenetwork', 'mevspace', 'vpn'
];
const RDNS_VPN = /(^|[.-])(vpn|tor-?exit|proxy|exit-?node)([.-]|\d|$)/i;
const RDNS_HOSTING = /(^|[.-])(vps|static\.\d|server|host|cloud|compute|dedicated|colo)([.-]|\d|$)/i;

// Residential / consumer networks that share a name with a cloud brand.
const NOT_DATACENTER = ['google fiber', 'microsoft corp msn', 'amazon prime'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** whole-word, case-insensitive keyword match; returns the matched keyword or null */
function match(list, text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  return list.find(k => new RegExp('(^|[^a-z0-9])' + esc(k.trim()) + '([^a-z0-9]|$)').test(t)) || null;
}

/**
 * @param {{asnOrg?:string, asnNumber?:number, isTor?:boolean, reverseDns?:string[]}} input
 * @returns {{is_tor:boolean,is_datacenter:boolean,is_vpn_likely:boolean,reasons:string[]}}
 */
function classify({ asnOrg, isTor, reverseDns } = {}) {
  const reasons = [];
  const out = { is_tor: !!isTor, is_datacenter: false, is_vpn_likely: false, reasons };
  if (isTor) reasons.push('Listed in the Tor Project exit node list');
  const vpnHit = match(VPN, asnOrg);
  if (vpnHit) { out.is_vpn_likely = true; reasons.push(`Network operator "${asnOrg}" is commonly used by VPN providers`); }
  const dcHit = match(NOT_DATACENTER, asnOrg) ? null : match(DATACENTER, asnOrg);
  if (dcHit || vpnHit) { out.is_datacenter = true; if (dcHit) reasons.push(`Network operator "${asnOrg}" is a hosting / cloud provider`); }
  const host = (reverseDns || []).join(' ');
  if (host && RDNS_VPN.test(host)) { out.is_vpn_likely = true; reasons.push('Reverse DNS name suggests a VPN, proxy or Tor node'); }
  else if (host && !out.is_datacenter && RDNS_HOSTING.test(host)) { out.is_datacenter = true; reasons.push('Reverse DNS name suggests a server or hosting provider'); }
  if (!reasons.length) reasons.push('No hosting, VPN or Tor signals found (looks like a regular ISP / residential or mobile network)');
  return out;
}

module.exports = { classify, DATACENTER, VPN };
