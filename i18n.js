/* ===== Be Management Tools – i18n runtime (loaded in <head>) =====
 * Static pages are pre-rendered per language at build time (/es/, /pt/, /fr/, /de/, /it/; English at /).
 * This runtime:
 *  1. picks the language: explicit choice (switcher) > device location (if the visitor allowed it) >
 *     country of the connection (bm-payments /api/geo, Vercel IP geo) > browser language > English,
 *     and redirects from the English root to the matching pre-rendered version (never for bots);
 *  2. translates text that app.js injects at runtime (toasts, results, buttons) with /i18n/<lang>.json,
 *     including "{0}" placeholders for strings built from templates;
 *  3. runs the language switcher (#langSelect) and decorates the hero headline (gradient last word).
 */
(function () {
  const LANGS = ['en', 'es', 'pt', 'fr', 'de', 'it'];
  const LABELS = { en: 'EN', es: 'ES', pt: 'PT', fr: 'FR', de: 'DE', it: 'IT' };
  const NAMES = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
  const ES = 'AR BO CL CO CR CU DO EC ES GQ GT HN MX NI PA PE PR PY SV UY VE'.split(' ');
  const PT = 'BR PT AO MZ CV GW ST TL'.split(' ');
  const FR = 'FR BE LU MC SN CI CM ML BF NE TG BJ GA CG CD MG HT'.split(' ');
  const DE = 'DE AT LI'.split(' ');
  const IT = 'IT SM VA'.split(' ');
  const countryLang = c => { c = (c || '').toUpperCase(); return ES.includes(c) ? 'es' : PT.includes(c) ? 'pt' : FR.includes(c) ? 'fr' : DE.includes(c) ? 'de' : IT.includes(c) ? 'it' : c === 'CH' ? 'de' : c ? 'en' : null; };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  const m = location.pathname.match(/^\/(es|pt|fr|de|it)(?=\/|$)/);
  const current = m ? m[1] : 'en';
  const basePath = p => p.replace(/^\/(es|pt|fr|de|it)(?=\/|$)/, '') || '/';
  const localized = (lang, p) => { const b = basePath(p || location.pathname); return lang === 'en' ? b : '/' + lang + (b === '/' ? '/' : b); };
  const isBot = /bot|crawl|spider|slurp|lighthouse|headless|preview/i.test(navigator.userAgent);
  const geoUrl = () => (((window.APP_CONFIG || {}).PAYMENTS || {}).url || 'https://bm-payments.vercel.app').replace(/\/$/, '') + '/api/geo';

  // languages actually pre-rendered for this app (written by i18n-tools build); none → no redirects
  // (read lazily: i18n.js runs in <head> before the meta tag is parsed)
  const available = () => { const mt = document.querySelector('meta[name="bm-langs"]'); return mt ? mt.content.split(',').map(s => s.trim()).filter(l => LANGS.includes(l)) : ['en']; };
  function go(lang, why) {
    if (lang === current) return;
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => go(lang, why), { once: true }); return; }
    if (!available().includes(lang)) return;
    if (why) try { sessionStorage.setItem('bm_lang_why', why); } catch (e) {}
    location.replace(localized(lang) + location.search + location.hash);
  }
  function browserLang() {
    for (const l of (navigator.languages || [navigator.language || 'en'])) { const s = String(l).slice(0, 2).toLowerCase(); if (LANGS.includes(s)) return s; }
    return null;
  }
  function decide(country) {
    const byCountry = countryLang(country), byBrowser = browserLang();
    // location decides; when the country speaks English (or is unknown) the browser language may refine it
    return byCountry && byCountry !== 'en' ? byCountry : (byBrowser || byCountry || 'en');
  }

  // ---- 1. language selection / redirect ----
  const explicit = store.get('bm_lang');
  const qs = new URLSearchParams(location.search).get('lang');
  if (qs && LANGS.includes(qs)) { store.set('bm_lang', qs); if (qs !== current) go(qs); }
  else if (!isBot && explicit && LANGS.includes(explicit)) { if (current === 'en' && explicit !== 'en') go(explicit); }
  else if (!isBot && current === 'en') {
    let auto = null; try { auto = JSON.parse(store.get('bm_lang_auto') || 'null'); } catch (e) {}
    if (auto && auto.lang && Date.now() - auto.at < 30 * 864e5) { if (auto.lang !== 'en') go(auto.lang); }
    else {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500);
      fetch(geoUrl(), { signal: ctl.signal }).then(r => r.json()).catch(() => ({})).then(g => {
        const lang = decide(g && g.country);
        store.set('bm_lang_auto', JSON.stringify({ lang, country: (g && g.country) || null, at: Date.now() }));
        if (lang !== 'en') go(lang, 'country');
      });
    }
  }
  // precise location (only after the visitor accepted the soft-ask in consent.js)
  document.addEventListener('geo:position', e => {
    const { lat, lon, silent } = e.detail || {};
    fetch(geoUrl() + '?lat=' + lat + '&lon=' + lon).then(r => r.json()).then(g => {
      if (!g || !g.country) return;
      const lang = decide(g.country);
      store.set('bm_lang_auto', JSON.stringify({ lang, country: g.country, at: Date.now(), precise: true }));
      if (!store.get('bm_lang') && lang !== current) go(lang, 'location');
      else if (!silent && window.toast) toast(t('Thanks! Your region is set.'));
    }).catch(() => {});
  });

  // ---- 2. runtime dictionary for dynamic text ----
  let dict = null, patterns = [];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  function t(s) {
    if (!dict || current === 'en') return s;
    const k = norm(s); if (!k) return s;
    if (dict[k] != null) return preserve(s, dict[k]);
    for (const p of patterns) { const mm = k.match(p.re); if (mm) return preserve(s, p.out.replace(/\{(\d+)\}/g, (_, i) => mm[+i + 1])); }
    return s;
  }
  function preserve(orig, tr) { const lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0]; return lead + tr + trail; }
  window.bmT = t;
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT', 'SVG']);
  const done = new WeakMap();
  function translateNode(node) {
    if (node.nodeType === 3) {
      const p = node.parentNode; if (!p || SKIP.has(p.nodeName) || p.closest?.('[data-no-i18n],[translate=no]')) return;
      const v = node.nodeValue; if (!v || !/[A-Za-z]/.test(v) || done.get(node) === v) return;
      const out = t(v); done.set(node, out); if (out !== v) node.nodeValue = out;
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName) || node.closest('[data-no-i18n],[translate=no]')) return;
    for (const a of ATTRS) { const v = node.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const out = t(v); if (out !== v) node.setAttribute(a, out); } }
    if ((node.nodeName === 'INPUT') && /^(button|submit)$/i.test(node.type) && node.value) node.value = t(node.value);
    if (node.nodeName === 'OPTION') { const v = node.textContent; const out = t(v); if (out !== v) node.textContent = out; return; }
    // inline unit (text mixed with <b>, <a>, <code>…) translated as one HTML string
    const key = node.children.length && node.childNodes.length > 1 && /^(P|LI|TD|TH|LABEL|SPAN|SMALL|H[1-6]|SUMMARY|DT|DD|FIGCAPTION|BUTTON|A|DIV)$/.test(node.nodeName) ? norm(node.innerHTML) : null;
    if (key && dict && dict[key] != null && done.get(node) !== key) { done.set(node, key); node.innerHTML = dict[key]; return; }
    for (const c of node.childNodes) translateNode(c);
  }
  function scan(root) { if (dict) translateNode(root || document.body); }
  function loadDict() {
    if (current === 'en') return Promise.resolve();
    return fetch('/i18n/' + current + '.json', { cache: 'force-cache' }).then(r => r.ok ? r.json() : {}).then(d => {
      dict = d || {};
      patterns = Object.keys(dict).filter(k => /\{\d+\}/.test(k)).map(k => ({
        re: new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)\\\}/g, '(.+?)') + '$'), out: dict[k]
      }));
    }).catch(() => { dict = {}; });
  }

  // ---- 3. switcher + hero decoration ----
  function mountSwitcher() {
    document.querySelectorAll('#langSelect').forEach(sel => {
      const AV = available();
      sel.closest('.lang-switch')?.classList.toggle('hidden', AV.length < 2);
      sel.innerHTML = AV.map(l => `<option value="${l}" ${l === current ? 'selected' : ''} title="${NAMES[l]}">${LABELS[l]}</option>`).join('');
      sel.setAttribute('translate', 'no');
      sel.addEventListener('change', () => { store.set('bm_lang', sel.value); location.href = localized(sel.value) + location.search + location.hash; });
    });
    document.querySelectorAll('a[data-i18n-href]').forEach(a => { a.href = localized(current, a.getAttribute('data-i18n-href')); });
  }
  function decorateHero() {
    const h = document.querySelector('.hero h1'); if (!h || h.querySelector('.hl')) return;
    const txt = h.textContent.trim(); const i = txt.lastIndexOf(' '); if (i < 1) return;
    h.textContent = '';
    h.append(document.createTextNode(txt.slice(0, i + 1)));
    const s = document.createElement('span'); s.className = 'hl'; s.textContent = txt.slice(i + 1).replace(/[.!?]$/, ''); h.append(s);
    const d = document.createElement('span'); d.className = 'dot-end'; d.textContent = '.'; h.append(d);
  }

  document.documentElement.lang = current;
  const ready = loadDict();
  document.addEventListener('DOMContentLoaded', () => {
    mountSwitcher();
    ready.then(() => {
      scan();
      decorateHero();
      if (dict) new MutationObserver(muts => {
        for (const mu of muts) {
          if (mu.type === 'characterData') translateNode(mu.target);
          else if (mu.type === 'attributes') translateNode(mu.target);
          else mu.addedNodes.forEach(n => translateNode(n));
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      let why = null; try { why = sessionStorage.getItem('bm_lang_why'); sessionStorage.removeItem('bm_lang_why'); } catch (e) {}
      if (why && window.toast) setTimeout(() => toast(t('Showing this page in your language.') + ' ' + NAMES[current]), 600);
    });
  });
  document.addEventListener('i18n:scan', () => scan());
  window.bmI18n = { lang: current, langs: LANGS, localized, t, scan, setLang: l => { store.set('bm_lang', l); location.href = localized(l); } };
})();
