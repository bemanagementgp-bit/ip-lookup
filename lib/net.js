/** Network helpers with hard timeouts: reverse DNS, hostname resolution, RDAP, cached remote lists. */
const dns = require('dns');
const { normalizeIp } = require('./ip');
// rdap.org (Cloudflare) answers 403 to requests without a User-Agent.
const UA = 'ip-lookup/1.0 (+https://iplookup-tool.vercel.app)';

const resolver = () => {
  const r = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
  if (process.env.DNS_SERVERS) r.setServers(process.env.DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
  return r;
};

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise(res => { t = setTimeout(() => res(fallback), ms); })
  ]).finally(() => clearTimeout(t));
}

async function fetchWithTimeout(url, opts = {}, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
  finally { clearTimeout(t); }
}

/** PTR records (max 3), [] on failure / timeout (2 s). */
async function reverseDns(ip, ms = 2000) {
  const names = await withTimeout(resolver().reverse(ip), ms, []);
  return (names || []).slice(0, 3);
}

/** A + AAAA for a hostname, deduplicated, max `max` addresses. */
async function resolveHost(host, max = 4, ms = 3000) {
  const r = resolver();
  const [a, aaaa] = await Promise.all([
    withTimeout(r.resolve4(host), ms, []),
    withTimeout(r.resolve6(host), ms, [])
  ]);
  const out = [];
  for (const ip of [...(a || []), ...(aaaa || [])]) {
    const n = normalizeIp(ip);
    if (n && !out.find(x => x.ip === n.ip)) out.push(n);
  }
  // keep a mix of v4 and v6 when trimming
  const v4 = out.filter(x => x.version === 4), v6 = out.filter(x => x.version === 6);
  const half = Math.ceil(max / 2);
  const picked = [...v4.splice(0, half), ...v6.splice(0, half)];
  return [...picked, ...v4, ...v6].slice(0, max);
}

/** Network info from RDAP (rdap.org bootstrap → RIR). Optional: null on any failure. 3 s timeout. */
async function rdap(ip, ms = 3000) {
  try {
    const r = await fetchWithTimeout('https://rdap.org/ip/' + ip /* already validated + normalised; encoding ':' breaks rdap.org */, { headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': UA }, redirect: 'follow' }, ms);
    if (!r.ok) return null;
    const d = await r.json();
    const cidrs = (d.cidr0_cidrs || []).map(c => (c.v4prefix || c.v6prefix) + '/' + c.length);
    const range = d.startAddress && d.endAddress ? d.startAddress + ' – ' + d.endAddress : null;
    let abuse = null;
    const walk = ents => (ents || []).forEach(e => {
      if (!abuse && (e.roles || []).includes('abuse')) {
        const v = (e.vcardArray && e.vcardArray[1]) || [];
        const em = v.find(x => x[0] === 'email');
        if (em) abuse = em[3];
      }
      walk(e.entities);
    });
    walk(d.entities);
    const port43 = String(d.port43 || '').toLowerCase();
    const registry = ['arin', 'ripe', 'apnic', 'lacnic', 'afrinic'].find(x => port43.includes(x)
      || (d.links || []).some(l => String(l.href || '').includes(x))) || null;
    return {
      name: d.name || null,
      range,
      cidr: cidrs.join(', ') || null,
      registry: registry ? registry.toUpperCase() : null,
      abuse_email: abuse,
      country: d.country || null
    };
  } catch (e) { return null; }
}

/** Generic in-memory cached text/json fetch. Keeps serving the stale copy if a refresh fails. */
function cachedList(url, ttlMs, parse, ms = 4000) {
  let data = null, at = 0, pending = null;
  return async function get() {
    if (data && Date.now() - at < ttlMs) return data;
    if (!pending) {
      pending = fetchWithTimeout(url, { headers: { 'User-Agent': UA } }, ms)
        .then(async r => { if (!r.ok) throw new Error('HTTP ' + r.status); data = parse(await r.text()); at = Date.now(); return data; })
        .catch(() => data)
        .finally(() => { pending = null; });
    }
    return pending;
  };
}

const torExits = cachedList('https://check.torproject.org/torbulkexitlist', 60 * 60 * 1000,
  txt => new Set(txt.split(/\s+/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))));

const feodo = cachedList('https://feodotracker.abuse.ch/downloads/ipblocklist.json', 6 * 60 * 60 * 1000,
  txt => { const m = new Map(); for (const e of JSON.parse(txt)) m.set(e.ip_address, e); return m; }, 6000);

/** true / false, or null if the list could not be loaded */
async function isTorExit(ip) {
  const set = await withTimeout(torExits(), 3500, null);
  return set ? set.has(ip) : null;
}

module.exports = { withTimeout, fetchWithTimeout, reverseDns, resolveHost, rdap, cachedList, torExits, feodo, isTorExit, resolver };
