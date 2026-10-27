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
  // PTR names are attacker-controlled: keep strings only, bounded length (rendered escaped client-side).
  return (Array.isArray(names) ? names : []).filter(n => typeof n === 'string').slice(0, 3).map(n => n.slice(0, 253));
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
    // rdap.org redirects to the RIR's RDAP server: only accept answers that stayed on HTTPS.
    if (r.url && !/^https:\/\//i.test(r.url)) return null;
    const d = await r.json();
    if (!d || typeof d !== 'object') return null;
    const s = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const cidrs = (Array.isArray(d.cidr0_cidrs) ? d.cidr0_cidrs : []).slice(0, 20)
      .filter(c => c && typeof (c.v4prefix || c.v6prefix) === 'string' && Number.isInteger(c.length))
      .map(c => String(c.v4prefix || c.v6prefix).slice(0, 45) + '/' + c.length);
    const range = s(d.startAddress, 45) && s(d.endAddress, 45) ? s(d.startAddress, 45) + ' – ' + s(d.endAddress, 45) : null;
    let abuse = null;
    const walk = (ents, depth) => (Array.isArray(ents) && depth < 6 ? ents : []).forEach(e => {
      if (!e || typeof e !== 'object') return;
      if (!abuse && Array.isArray(e.roles) && e.roles.includes('abuse')) {
        const v = (Array.isArray(e.vcardArray) && Array.isArray(e.vcardArray[1])) ? e.vcardArray[1] : [];
        const em = v.find(x => Array.isArray(x) && x[0] === 'email');
        // only a plausible e-mail address is passed on (it becomes a mailto: link in the UI)
        if (em && typeof em[3] === 'string' && /^[^\s@<>"'()]{1,64}@[a-z0-9.-]{1,253}$/i.test(em[3].trim())) abuse = em[3].trim();
      }
      walk(e.entities, depth + 1);
    });
    walk(d.entities, 0);
    const port43 = String(d.port43 || '').toLowerCase();
    const registry = ['arin', 'ripe', 'apnic', 'lacnic', 'afrinic'].find(x => port43.includes(x)
      || (Array.isArray(d.links) ? d.links : []).some(l => l && String(l.href || '').includes(x))) || null;
    return {
      name: s(d.name, 200),
      range,
      cidr: cidrs.join(', ') || null,
      registry: registry ? registry.toUpperCase() : null,
      abuse_email: abuse,
      country: s(d.country, 2)
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
