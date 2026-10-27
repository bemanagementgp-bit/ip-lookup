/* ===== Be Management Tools – cookie consent + optional geolocation (loaded in <head>, before monetize.js) =====
 * - Google Consent Mode v2 defaults to "denied" until the visitor chooses.
 * - Categories: necessary (always), analytics (GA4), ads (AdSense + personalization).
 * - Choice stored in localStorage `bm_consent` ({v, analytics, ads, at}) for 12 months.
 * - After the banner is answered, a soft-ask card offers to use the device location to pick the language;
 *   the real browser prompt only appears if the visitor clicks "Use my location" (never on page load).
 * Exposes window.bmConsent: { get(), has(cat), whenGranted(cat, fn), open(), askLocation() }.
 * UI strings are English; i18n.js translates them like any other text.
 */
(function () {
  const KEY = 'bm_consent', GEO_KEY = 'bm_geo_ask', VERSION = 1, TTL = 365 * 864e5;
  const listeners = { analytics: [], ads: [] };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'granted', security_storage: 'granted', wait_for_update: 500 });

  function read() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.v === VERSION && Date.now() - c.at < TTL) return c;
    } catch (e) {}
    return null;
  }
  function apply(c) {
    gtag('consent', 'update', {
      analytics_storage: c.analytics ? 'granted' : 'denied',
      ad_storage: c.ads ? 'granted' : 'denied', ad_user_data: c.ads ? 'granted' : 'denied', ad_personalization: c.ads ? 'granted' : 'denied'
    });
    ['analytics', 'ads'].forEach(cat => { if (c[cat]) { listeners[cat].splice(0).forEach(fn => { try { fn(); } catch (e) {} }); } });
  }
  function save(analytics, ads) {
    const c = { v: VERSION, analytics: !!analytics, ads: !!ads, at: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    apply(c);
    document.dispatchEvent(new CustomEvent('consent:changed', { detail: c }));
    return c;
  }

  function banner(showPrefs) {
    const old = document.getElementById('bmConsent'); if (old) old.remove();
    const cur = read() || { analytics: false, ads: false };
    const el = document.createElement('div');
    el.id = 'bmConsent'; el.className = 'consent'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Cookie preferences');
    el.innerHTML = `
      <h4>Cookies & privacy</h4>
      <p>We use necessary cookies to make this tool work. With your permission we also use analytics to improve it and ads to keep it free. Your files and data never leave your device.</p>
      <div class="prefs ${showPrefs ? '' : 'hidden'}">
        <label><span>Necessary<small>Settings, language and Pro license on this device.</small></span><span class="switch"><input type="checkbox" checked disabled><i></i></span></label>
        <label><span>Analytics<small>Anonymous usage statistics (Google Analytics).</small></span><span class="switch"><input type="checkbox" data-cat="analytics" ${cur.analytics ? 'checked' : ''}><i></i></span></label>
        <label><span>Advertising<small>Ads that keep the tools free (Google AdSense).</small></span><span class="switch"><input type="checkbox" data-cat="ads" ${cur.ads ? 'checked' : ''}><i></i></span></label>
      </div>
      <div class="row">
        <button class="btn btn-primary no-arrow btn-sm" data-act="all">Accept all</button>
        <button class="btn btn-sm" data-act="none">Reject</button>
        <button class="btn btn-ghost btn-sm" data-act="${showPrefs ? 'save' : 'prefs'}">${showPrefs ? 'Save choices' : 'Customize'}</button>
        <a class="hint" href="/privacy" style="margin-left:auto">Privacy</a>
      </div>`;
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      if (act === 'prefs') { banner(true); return; }
      if (act === 'all') save(true, true);
      else if (act === 'none') save(false, false);
      else if (act === 'save') save(el.querySelector('[data-cat=analytics]').checked, el.querySelector('[data-cat=ads]').checked);
      el.remove();
      setTimeout(geoSoftAsk, 1200);
    });
    document.body.appendChild(el);
    document.dispatchEvent(new Event('i18n:scan'));
  }

  // ---- optional geolocation soft-ask (better language/region) ----
  function geoState() { try { return JSON.parse(localStorage.getItem(GEO_KEY) || 'null'); } catch (e) { return null; } }
  function setGeoState(s) { try { localStorage.setItem(GEO_KEY, JSON.stringify(Object.assign({ at: Date.now() }, s))); } catch (e) {} }
  function geoSoftAsk() {
    if (!('geolocation' in navigator) || document.getElementById('bmGeoAsk')) return;
    const st = geoState();
    if (st && (st.result === 'granted' || st.result === 'denied' || Date.now() - st.at < 30 * 864e5)) return;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'prompt') showGeo(); else if (p.state === 'granted') locate(true); }).catch(showGeo);
    } else showGeo();
  }
  function showGeo() {
    const el = document.createElement('div');
    el.id = 'bmGeoAsk'; el.className = 'geo-ask'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<strong>Show this tool in your language?</strong>
      <p>Allow your location once so we can set the right language and region for you. We only use the country and never store your position.</p>
      <div class="row"><button class="btn btn-primary no-arrow btn-sm" data-g="yes">Use my location</button><button class="btn btn-ghost btn-sm" data-g="no">Not now</button></div>`;
    el.addEventListener('click', e => {
      const g = e.target.closest('[data-g]')?.dataset.g; if (!g) return;
      el.remove();
      if (g === 'yes') locate(false); else setGeoState({ result: 'dismissed' });
    });
    document.body.appendChild(el);
    document.dispatchEvent(new Event('i18n:scan'));
  }
  function locate(silent) {
    navigator.geolocation.getCurrentPosition(pos => {
      setGeoState({ result: 'granted' });
      const lat = Math.round(pos.coords.latitude * 100) / 100, lon = Math.round(pos.coords.longitude * 100) / 100;
      document.dispatchEvent(new CustomEvent('geo:position', { detail: { lat, lon, silent } }));
    }, err => { setGeoState({ result: err.code === 1 ? 'denied' : 'error' }); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 24 * 3600e3 });
  }

  window.bmConsent = {
    get: read,
    has: cat => { const c = read(); return !!(c && c[cat]); },
    whenGranted(cat, fn) { if (this.has(cat)) fn(); else listeners[cat].push(fn); },
    open: () => banner(true),
    askLocation: () => { setGeoState({ result: null, at: 0 }); showGeo(); }
  };

  const existing = read();
  if (existing) apply(existing);
  document.addEventListener('DOMContentLoaded', () => {
    if (!existing) setTimeout(() => banner(false), 400);
    else setTimeout(geoSoftAsk, 2500);
  });
})();
