/* IP Lookup – front-end. Talks only to the same-origin /api/* functions. */
(function () {
  'use strict';
  const C = window.APP_CONFIG || {};
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const proKey = () => { try { return localStorage.getItem('pro_license_key') || ''; } catch (e) { return ''; } };
  const FREE_BATCH = 10, PRO_BATCH = 1000;
  const HIST_KEY = 'iplookup_history', BATCH_KEY = 'iplookup_batch_input';

  // ---------- price + pro locks ----------
  function setPrices() { $$('#proPrice,[data-pro-price]').forEach(el => { el.textContent = C.PRO_PRICE || '$9'; }); }
  function refreshPro() { const pro = isPro(); $$('[data-pro-lock]').forEach(el => el.classList.toggle('hidden', pro)); }
  document.addEventListener('pro:changed', refreshPro);

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ headers: { Accept: 'application/json' } }, opts || {}));
    let d = {};
    try { d = await r.json(); } catch (e) { d = { error: 'Unexpected response from the server (' + r.status + ')' }; }
    d._status = r.status;
    return d;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); track('copy', {}); }
    catch (e) { toast('Copy failed: select and copy manually'); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (b) copy(b.getAttribute('data-copy'));
  });

  // ---------- shared renderers ----------
  const place = g => g ? [g.city, g.region && g.region !== g.city ? g.region : null, g.country].filter(Boolean).join(', ') : '';
  const flagEmoji = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '';
  const osm = g => `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=10/${g.lat}/${g.lon}`;

  function pillsHtml(f) {
    if (!f) return '';
    const p = [];
    p.push(f.is_vpn_likely ? '<span class="pill warn">VPN likely</span>' : '<span class="pill ok">No VPN signals</span>');
    p.push(f.is_tor ? '<span class="pill bad">Tor exit node</span>' : '<span class="pill ok">Not Tor</span>');
    p.push(f.is_datacenter ? '<span class="pill warn">Datacenter / hosting</span>' : '<span class="pill ok">ISP / residential</span>');
    return '<div class="pills">' + p.join('') + '</div>';
  }
  function kv(label, value, opts) {
    opts = opts || {};
    if (value == null || value === '') value = '<span class="muted">—</span>';
    const copyBtn = opts.copy ? `<button type="button" class="copy-mini" data-copy="${esc(opts.copy)}" aria-label="Copy ${esc(label)}">Copy</button>` : '';
    return `<div${opts.wide ? ' class="wide"' : ''}><dt>${esc(label)}</dt><dd${opts.mono ? ' class="mono"' : ''}><span>${value}</span>${copyBtn}</dd></div>`;
  }
  function attribHtml(list) {
    const lic = a => a.license ? ' (' + esc(a.license) + ')' : '';
    return '<p class="attrib">' + (list || []).map(a => {
      if (/ by DB-IP$/.test(a.text)) return `${esc(a.text.replace(/DB-IP$/, ''))}<a href="${esc(a.url)}" target="_blank" rel="noopener">DB-IP</a>${lic(a)}`;
      return a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.text)}</a>${lic(a)}` : esc(a.text) + lic(a);
    }).join(' · ') + '</p>';
  }
  function specialHtml(r) {
    return `<div class="special-box"><b>${esc(r.special.label)}</b> <span class="muted mono">(${esc(r.special.range)})</span><br>${esc(r.special.description)}</div>`;
  }

  // ---------- browser / OS (local only, never sent) ----------
  function clientSummary() {
    const ua = navigator.userAgent;
    const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const vm = ua.match(b === 'Edge' ? /Edg\/(\d+)/ : b === 'Opera' ? /OPR\/(\d+)/ : b === 'Firefox' ? /Firefox\/(\d+)/ : b === 'Chrome' ? /Chrome\/(\d+)/ : /Version\/(\d+)/);
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    return `${b}${vm ? ' ' + vm[1] : ''} on ${os}${tz ? ' · device time zone ' + tz : ''}`;
  }

  // ---------- Your IP ----------
  async function loadMe() {
    const body = $('#meBody');
    const dbg = new URLSearchParams(location.search).get('debug_ip');
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    let d;
    try { d = await api('/api/me' + (dbg && isLocal ? '?debug_ip=' + encodeURIComponent(dbg) : '')); }
    catch (e) { d = { error: 'Network error. Check your connection and reload.' }; }
    if (d.error) { body.innerHTML = `<p class="err">${esc(d.error)}</p>`; return; }
    const r = d.result || {}, g = r.geo, a = r.asn;
    const loc = g ? `${flagEmoji(g.country_code)} ${esc(place(g))} <span class="muted">· approximate</span>` : (r.special ? esc(r.special.label) : '<span class="muted">Location unknown</span>');
    let html = `<div class="myip-top"><span class="myip" id="myIp">${esc(d.ip)}</span><span class="vtag">IPv${esc(d.version || r.version)}</span>
      <button type="button" class="btn btn-sm" data-copy="${esc(d.ip)}">📋 Copy</button>
      <button type="button" class="btn btn-sm btn-ghost" id="meLookup">Details ↓</button></div>
      <p class="myip-loc">${loc}</p>`;
    if (r.special) html += specialHtml(r);
    else html += pillsHtml(r.flags);
    html += '<dl class="kv">';
    html += kv('ISP / organization', a && a.org ? esc(a.org) : null);
    html += kv('ASN', a ? 'AS' + esc(a.number) : null, { mono: true });
    html += kv('Reverse DNS', r.reverse_dns && r.reverse_dns.length ? esc(r.reverse_dns.join(', ')) : null, { mono: true });
    html += kv('Coordinates', g && g.lat != null ? `${g.lat}, ${g.lon} · <a href="${esc(osm(g))}" target="_blank" rel="noopener">Open in OpenStreetMap</a>` : null);
    html += kv('Browser / device', esc(clientSummary()), { wide: true });
    html += '</dl>';
    html += attribHtml(d.attribution);
    body.innerHTML = html;
    $('#meLookup').addEventListener('click', () => { $('#q').value = d.ip; runLookup(d.ip); $('#lookupCard').scrollIntoView({ behavior: 'smooth' }); });
  }

  // ---------- Lookup ----------
  function resultHtml(r) {
    if (r.error) return `<div class="result"><p class="err">${esc(r.ip)}: ${esc(r.error)}</p></div>`;
    const g = r.geo, a = r.asn, n = r.network;
    let h = `<div class="result"><div class="result-head"><span class="ip">${esc(r.ip)}</span><span class="vtag">IPv${r.version}</span>
      <button type="button" class="copy-mini" data-copy="${esc(r.ip)}">Copy</button></div>`;
    if (r.special) return h + specialHtml(r) + '</div>';
    h += '<h3 class="group-title">Location <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">· approximate</span></h3><dl class="kv">';
    h += kv('Country', g && g.country ? `${flagEmoji(g.country_code)} ${esc(g.country)} <span class="muted">(${esc(g.country_code)})</span>` : null);
    h += kv('Region / city', g ? esc([g.region, g.city !== g.region ? g.city : null].filter(Boolean).join(' · ')) : null);
    h += kv('Coordinates', g && g.lat != null ? `${g.lat}, ${g.lon} · <a href="${esc(osm(g))}" target="_blank" rel="noopener">Map</a>` : null);
    if (g && g.timezone) h += kv('Time zone', esc(g.timezone));
    h += '</dl>';
    if (g && g.accuracy_note) h += `<p class="hint">${esc(g.accuracy_note)}</p>`;
    h += '<h3 class="group-title">Network</h3><dl class="kv">';
    h += kv('ISP / organization', a && a.org ? esc(a.org) : null);
    h += kv('ASN', a ? 'AS' + esc(a.number) : null, { mono: true, copy: a ? 'AS' + a.number : '' });
    h += kv('Reverse DNS', r.reverse_dns && r.reverse_dns.length ? esc(r.reverse_dns.join(', ')) : null, { mono: true });
    h += kv('Network name', n && n.name ? esc(n.name) : null, { mono: true });
    h += kv('Range / CIDR', n ? esc([n.cidr, n.range].filter(Boolean).join(' · ')) : null, { mono: true, wide: true });
    h += kv('Registry', n && n.registry ? esc(n.registry) : null);
    h += kv('Abuse contact', n && n.abuse_email ? `<a href="mailto:${esc(n.abuse_email)}">${esc(n.abuse_email)}</a>` : null);
    h += '</dl>';
    if (r.network === null) h += '<p class="hint">Registration data (RDAP) was not available for this address right now.</p>';
    h += '<h3 class="group-title">Security</h3>' + pillsHtml(r.flags);
    h += '<ul class="reasons">' + (r.flags.reasons || []).map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
    h += '</div>';
    return h;
  }

  let lookupSeq = 0;
  async function runLookup(q, opts) {
    q = String(q || '').trim();
    const out = $('#lookupOut'), err = $('#lookupErr');
    err.textContent = '';
    if (!q) { err.textContent = 'Enter an IP address or a domain name.'; return; }
    const seq = ++lookupSeq;
    out.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Looking up ' + esc(q) + '…</div>';
    $('#lookupBtn').disabled = true;
    let d;
    try { d = await api('/api/lookup?q=' + encodeURIComponent(q)); }
    catch (e) { d = { error: 'Network error. Check your connection and try again.' }; }
    if (seq !== lookupSeq) return;
    $('#lookupBtn').disabled = false;
    if (d.error) { out.innerHTML = ''; err.textContent = d.error; return; }
    let h = '';
    if (d.host) h += `<p class="hint" style="margin-top:14px"><b>${esc(d.host)}</b> resolves to ${d.results.length} address${d.results.length > 1 ? 'es' : ''}${d.results.length >= 4 ? ' (first 4 shown)' : ''}.</p>`;
    h += d.results.map(resultHtml).join('');
    const raw = Object.assign({}, d); delete raw._status;
    h += `<details class="raw"><summary>Raw JSON</summary><pre>${esc(JSON.stringify(raw, null, 2))}</pre></details>`;
    h += `<div class="row" style="margin-top:12px"><button type="button" class="btn btn-sm" id="shareBtn">🔗 Copy share link</button></div>`;
    h += attribHtml(d.attribution);
    out.innerHTML = h;
    $('#shareBtn').addEventListener('click', () => copy(location.origin + '/?q=' + encodeURIComponent(q)));
    if (!(opts && opts.fromUrl)) {
      const u = new URL(location.href); u.searchParams.set('q', q); history.replaceState(null, '', u);
    }
    addHistory(q);
    track('generate', { type: d.host ? 'domain' : 'ip' });
  }

  // history (local only)
  function renderHistory() {
    const list = store.get(HIST_KEY, []);
    $('#history').innerHTML = list.map(q => `<button type="button" class="chip mono" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  }
  function addHistory(q) {
    const list = store.get(HIST_KEY, []).filter(x => x !== q);
    list.unshift(q); store.set(HIST_KEY, list.slice(0, 10)); renderHistory();
  }

  // ---------- Batch ----------
  function parseIps(text) {
    const toks = String(text || '').split(/[\s,;|"']+/).map(t => t.trim().replace(/^\[|\]$/g, '')).filter(Boolean);
    const ok = toks.filter(t => /^\d{1,3}(\.\d{1,3}){3}$/.test(t) || (/^[0-9a-f:.]+$/i.test(t) && t.includes(':') && t.split(':').length > 2));
    return [...new Set(ok)];
  }
  function updateCount() {
    const n = parseIps($('#batchInput').value).length;
    const max = isPro() ? PRO_BATCH : FREE_BATCH;
    $('#batchCount').textContent = `${n} IP${n === 1 ? '' : 's'} detected · limit ${max}${isPro() ? ' (Pro)' : ' (free)'}`;
  }
  let batchRows = [], batchRaw = null, sortState = { key: null, dir: 1 };
  function rowOf(r) {
    const f = r.flags || {};
    const flags = r.error ? 'invalid' : r.special ? r.special.label : [f.is_tor && 'Tor', f.is_vpn_likely && 'VPN likely', f.is_datacenter && 'Datacenter'].filter(Boolean).join(', ') || '—';
    return {
      ip: r.ip, country: r.geo ? (r.geo.country_code || '') : '', city: r.geo ? [r.geo.city, r.geo.region].filter(Boolean).join(', ') : '',
      asn: r.asn ? r.asn.number : '', org: r.asn ? r.asn.org || '' : '', rdns: (r.reverse_dns || []).join(' '), flags
    };
  }
  function renderBatch() {
    const rows = batchRows.slice();
    if (sortState.key) {
      const k = sortState.key;
      rows.sort((a, b) => (typeof a[k] === 'number' && typeof b[k] === 'number' ? a[k] - b[k] : String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true })) * sortState.dir);
    }
    $('#batchTable tbody').innerHTML = rows.map(r => `<tr><td class="mono">${esc(r.ip)}</td><td>${flagEmoji(r.country)} ${esc(r.country)}</td><td>${esc(r.city)}</td><td class="num mono">${r.asn ? 'AS' + esc(r.asn) : ''}</td><td>${esc(r.org)}</td><td class="mono">${esc(r.rdns)}</td><td>${esc(r.flags)}</td></tr>`).join('');
    $$('#batchTable th').forEach(th => th.setAttribute('aria-sort', th.dataset.key === sortState.key ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none'));
  }
  async function runBatch() {
    const err = $('#batchErr'); err.textContent = '';
    const ips = parseIps($('#batchInput').value);
    if (!ips.length) { err.textContent = 'No valid IP addresses found. Paste one IPv4 or IPv6 address per line.'; return; }
    if (ips.length > PRO_BATCH) { err.textContent = `Maximum ${PRO_BATCH} IPs per batch (you pasted ${ips.length}).`; return; }
    if (ips.length > FREE_BATCH && !isPro()) { err.textContent = `Free batches are limited to ${FREE_BATCH} IPs (you pasted ${ips.length}).`; openPro('batch'); return; }
    const btn = $('#batchRun'); btn.disabled = true; btn.textContent = 'Running…';
    let d;
    try { d = await api('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ips, key: proKey() || undefined }) }); }
    catch (e) { d = { error: 'Network error. Try again.' }; }
    btn.disabled = false; btn.textContent = 'Run batch';
    if (d._status === 402 || d.upgrade) { err.textContent = d.error || 'Upgrade to Pro for larger batches.'; openPro('batch'); return; }
    if (d.error) { err.textContent = d.error; return; }
    batchRaw = d.results; batchRows = d.results.map(rowOf); sortState = { key: null, dir: 1 };
    renderBatch(); $('#batchOut').classList.remove('hidden');
    track('batch', { count: ips.length });
  }
  function download(name, mime, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportBatch(kind) {
    if (!isPro()) { openPro('export'); return; }
    if (!batchRows.length) { toast('Run a batch first'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'json') download(`ip-lookup-${stamp}.json`, 'application/json', JSON.stringify({ results: batchRaw, attribution: ['IP geolocation by DB-IP (https://db-ip.com, CC BY 4.0)', 'ASN data: RouteViews / DB-IP (CC BY 4.0)'] }, null, 2));
    else {
      const cols = ['ip', 'country', 'city', 'asn', 'org', 'rdns', 'flags'];
      const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = [cols.join(',')].concat(batchRows.map(r => cols.map(c => q(r[c])).join(','))).join('\n') + '\n# IP geolocation by DB-IP (https://db-ip.com) CC BY 4.0; ASN data: RouteViews / DB-IP CC BY 4.0\n';
      download(`ip-lookup-${stamp}.csv`, 'text/csv', csv);
    }
    track('download', { format: kind });
  }

  // ---------- Blacklist ----------
  async function runBlacklist(ip) {
    const err = $('#blErr'), out = $('#blOut'); err.textContent = '';
    if (!isPro()) { openPro('blacklist'); return; }
    ip = String(ip || '').trim();
    if (!ip) { err.textContent = 'Enter an IP address.'; return; }
    out.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Checking blocklists…</div>';
    let d;
    try { d = await api('/api/blacklist?ip=' + encodeURIComponent(ip) + '&key=' + encodeURIComponent(proKey())); }
    catch (e) { d = { error: 'Network error. Try again.' }; }
    if (d._status === 402) { out.innerHTML = ''; err.textContent = d.error; openPro('blacklist'); return; }
    if (d.error) { out.innerHTML = ''; err.textContent = d.error; return; }
    const st = c => c.listed === true ? '<span class="bl-status listed">Listed</span>' : c.listed === false ? '<span class="bl-status clean">Clean</span>' : '<span class="muted">n/a</span>';
    out.innerHTML = `<p style="margin:14px 0 6px"><b class="mono">${esc(d.ip)}</b>: ${d.listed ? '<span class="bl-status listed">listed on at least one list</span>' : '<span class="bl-status clean">not listed</span>'}</p>
      <div class="table-wrap"><table id="blTable"><thead><tr><th>Source</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      ${d.checks.map(c => `<tr><td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.source)}</a>` : esc(c.source)}</td><td>${st(c)}</td><td>${esc(c.detail)}</td></tr>`).join('')}
      </tbody></table></div><p class="hint">Delisting is handled by each list operator. Results reflect the moment of the check.</p>`;
    track('blacklist', {});
  }

  // ---------- wire up ----------
  function init() {
    setPrices(); refreshPro(); renderHistory();
    $('#lookupForm').addEventListener('submit', e => { e.preventDefault(); runLookup($('#q').value); });
    document.addEventListener('click', e => {
      const chip = e.target.closest('[data-q]');
      if (chip) { $('#q').value = chip.dataset.q; runLookup(chip.dataset.q); }
      const ex = e.target.closest('[data-export]');
      if (ex) exportBatch(ex.dataset.export);
    });
    $('#clearHistory').addEventListener('click', () => { store.set(HIST_KEY, []); renderHistory(); toast('History cleared'); });

    const bi = $('#batchInput');
    const saved = store.get(BATCH_KEY, null); if (saved) bi.value = saved;
    bi.addEventListener('input', () => { store.set(BATCH_KEY, bi.value); updateCount(); });
    $('#batchRun').addEventListener('click', runBatch);
    $('#batchFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 2e6) { toast('File too large (max 2 MB)'); return; }
      const rd = new FileReader();
      rd.onload = () => { const ips = parseIps(rd.result); bi.value = ips.join('\n'); store.set(BATCH_KEY, bi.value); updateCount(); toast(`${ips.length} IPs loaded from ${f.name}`); };
      rd.readAsText(f); e.target.value = '';
    });
    $$('#batchTable th').forEach(th => {
      const sort = () => { sortState = { key: th.dataset.key, dir: sortState.key === th.dataset.key ? -sortState.dir : 1 }; renderBatch(); };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
    updateCount();
    document.addEventListener('pro:changed', updateCount);

    $('#blForm').addEventListener('submit', e => { e.preventDefault(); runBlacklist($('#blIp').value); });

    loadMe();
    const q = new URLSearchParams(location.search).get('q');
    if (q) { $('#q').value = q; runLookup(q, { fromUrl: true }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
