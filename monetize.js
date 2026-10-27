/* ===== Shared monetization + theme helpers (v2). Reads window.APP_CONFIG from config.js =====
 * - Theme toggle, toast, GA4, AdSense slots
 * - Pro licensing with real Lemon Squeezy License API validation (activate / validate / deactivate)
 * - Newsletter / lead capture (any form endpoint: Formspree, ConvertKit, Beehiiv, custom)
 */
(function () {
  const C = window.APP_CONFIG || {};
  // HTML-escape any value that is inserted with innerHTML (XSS defence)
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const escHTML = v => String(v == null ? '' : v).replace(/[&<>"'`]/g, ch => ESC[ch]);
  window.bmEsc = escHTML;

  // ---- Theme ----
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.setAttribute('data-theme', 'light');
  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem('theme', cur);
  };

  // ---- Toast ----
  let toastEl = null;
  window.toast = function (msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  // ---- consent gate (consent.js); without it, behave as "granted" for backwards compatibility ----
  const whenGranted = (cat, fn) => (window.bmConsent ? bmConsent.whenGranted(cat, fn) : fn());

  // ---- Analytics (GA4) – only if configured AND the visitor accepted analytics ----
  let gaLoaded = false;
  if (C.GA_ID) whenGranted('analytics', () => {
    if (gaLoaded) return; gaLoaded = true;
    const s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + C.GA_ID; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', C.GA_ID);
  });
  window.track = function (ev, params) { if (gaLoaded && window.gtag) gtag('event', ev, params || {}); };

  // ---- AdSense – only if configured AND the visitor accepted ads; otherwise slots show a placeholder ----
  let adsMounted = false;
  function mountAds() {
    if (!C.ADSENSE_CLIENT) return;
    whenGranted('ads', mountAdsNow);
  }
  function mountAdsNow() {
    if (adsMounted) return; adsMounted = true;
    const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + C.ADSENSE_CLIENT;
    document.head.appendChild(s);
    document.querySelectorAll('.ad-slot').forEach(el => {
      const ins = document.createElement('ins'); ins.className = 'adsbygoogle'; ins.style.display = 'block';
      ins.setAttribute('data-ad-client', C.ADSENSE_CLIENT);
      ins.setAttribute('data-ad-slot', el.dataset.slot || '');
      ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
      el.appendChild(ins); (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  // ---- Pro licensing (Lemon Squeezy License API) ----
  const LIC = Object.assign({ provider: 'lemonsqueezy', store_id: '', product_id: '', variant_id: '', recheck_days: 7, test_keys: [] }, C.LICENSE || {});
  const K = { flag: 'pro_license', key: 'pro_license_key', inst: 'pro_instance_id', at: 'pro_checked_at' };
  const LS_API = 'https://api.lemonsqueezy.com/v1/licenses/';

  // Mercado Pago via the bm-payments service (preferred when PAYMENTS.url is set); Lemon Squeezy otherwise.
  const PAY = Object.assign({ url: '', app: '' }, C.PAYMENTS || {});
  const mpMode = () => !!(PAY.url && PAY.app);
  async function payApi(path, opts) {
    const r = await fetch(PAY.url.replace(/\/$/, '') + path, Object.assign({ headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }, opts || {}));
    let data = {}; try { data = await r.json(); } catch (e) {}
    if (!r.ok && !data.error) data.error = 'Request failed (' + r.status + ')';
    return data;
  }

  window.isPro = function () { return localStorage.getItem(K.flag) === '1'; };
  function licenseConfigured() { return mpMode() || !!(LIC.product_id || LIC.store_id || LIC.variant_id); }
  function setPro(on, key, instanceId) {
    if (on) {
      localStorage.setItem(K.flag, '1');
      if (key) localStorage.setItem(K.key, key);
      if (instanceId) localStorage.setItem(K.inst, instanceId);
      localStorage.setItem(K.at, String(Date.now()));
    } else {
      Object.values(K).forEach(k => localStorage.removeItem(k));
    }
    document.dispatchEvent(new Event('pro:changed'));
    renderProStatus();
  }
  async function lsPost(path, body) {
    const r = await fetch(LS_API + path, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
    let data = null; try { data = await r.json(); } catch (e) { data = {}; }
    return data || {};
  }
  function matchesProduct(meta) {
    if (!meta) return false;
    if (LIC.product_id && String(meta.product_id) !== String(LIC.product_id)) return false;
    if (LIC.store_id && String(meta.store_id) !== String(LIC.store_id)) return false;
    if (LIC.variant_id && String(meta.variant_id) !== String(LIC.variant_id)) return false;
    return true;
  }
  function friendlyError(res) {
    const e = (res && res.error) ? String(res.error) : '';
    if (/activation limit/i.test(e)) return 'This key has reached its device limit. Deactivate it on another device first.';
    if (/expired/i.test(e)) return 'This license has expired.';
    if (/disabled|not found|invalid/i.test(e)) return 'Invalid license key.';
    return e || 'Could not validate the license. Please try again.';
  }

  window.activateLicense = async function (key) {
    key = (key || '').trim();
    if (!key) { toast('Enter your license key'); return false; }
    // Local test keys (owner testing only – set LICENSE.test_keys in config.js)
    if (Array.isArray(LIC.test_keys) && LIC.test_keys.includes(key)) {
      setPro(true, key, 'test'); toast('Pro activated (test key) 🎉'); closePro(); return true;
    }
    if (!licenseConfigured()) { toast('License validation is not set up yet. Contact support.'); return false; }
    toast('Checking license…');
    if (mpMode()) {
      try {
        const res = await payApi('/api/validate', { method: 'POST', body: JSON.stringify({ key, app: PAY.app }) });
        if (res.valid) { setPro(true, key, 'mp'); track('license_activated', { provider: 'mercadopago' }); toast('Pro activated 🎉'); closePro(); return true; }
        toast(res.error || 'Invalid license key'); return false;
      } catch (e) { toast('Network error while checking the license. Try again.'); return false; }
    }
    try {
      const instanceName = (C.APP_NAME || 'app') + ' · ' + (navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || 'web');
      const res = await lsPost('activate', { license_key: key, instance_name: instanceName });
      if (res.activated && matchesProduct(res.meta)) {
        setPro(true, key, res.instance && res.instance.id);
        track('license_activated', {});
        toast('Pro activated 🎉'); closePro(); return true;
      }
      if (res.activated && !matchesProduct(res.meta)) {
        // key is for another product – release the activation we just consumed
        try { await lsPost('deactivate', { license_key: key, instance_id: res.instance && res.instance.id }); } catch (e) {}
        toast('This key belongs to a different product.'); return false;
      }
      toast(friendlyError(res)); return false;
    } catch (e) {
      toast('Network error while checking the license. Try again.'); return false;
    }
  };

  window.deactivateLicense = async function () {
    const key = localStorage.getItem(K.key), inst = localStorage.getItem(K.inst);
    if (key && inst && inst !== 'test' && inst !== 'mp' && licenseConfigured()) {
      try { await lsPost('deactivate', { license_key: key, instance_id: inst }); } catch (e) {}
    }
    setPro(false); toast('Pro deactivated on this device');
  };

  async function recheckLicense() {
    if (!isPro()) return;
    const key = localStorage.getItem(K.key), inst = localStorage.getItem(K.inst);
    if (!key || inst === 'test' || !licenseConfigured()) return;
    const at = Number(localStorage.getItem(K.at) || 0);
    if (Date.now() - at < (LIC.recheck_days || 7) * 864e5) return;
    if (mpMode()) {
      try {
        const res = await payApi('/api/validate', { method: 'POST', body: JSON.stringify({ key, app: PAY.app }) });
        if (res.valid === true) localStorage.setItem(K.at, String(Date.now()));
        else if (res.valid === false) { setPro(false); toast('Your Pro license is no longer valid.'); }
      } catch (e) { /* offline */ }
      return;
    }
    try {
      const res = await lsPost('validate', { license_key: key, instance_id: inst || '' });
      if (res.valid === true && matchesProduct(res.meta)) { localStorage.setItem(K.at, String(Date.now())); }
      else if (res.valid === false) { setPro(false); toast('Your Pro license is no longer valid.'); }
    } catch (e) { /* offline: keep Pro until next check */ }
  }

  function renderProStatus() {
    const modal = document.getElementById('proModal'); if (!modal) return;
    let st = modal.querySelector('.pro-status');
    if (!st) { st = document.createElement('p'); st.className = 'hint pro-status'; modal.querySelector('.card').appendChild(st); }
    if (isPro()) {
      const key = localStorage.getItem(K.key) || '';
      st.innerHTML = '✅ Pro is active on this device' + (key ? ' (key …' + escHTML(key.slice(-6)) + ')' : '') +
        ' · <a href="#" data-action="deactivate">Deactivate</a>';
    } else st.innerHTML = '';
  }

  window.openPro = function (source) {
    track('pro_click', { source: source || 'unknown' });
    const m = document.getElementById('proModal');
    if (m) { m.classList.add('open'); renderProStatus(); const i = m.querySelector('#licenseKey'); return; }
    if (C.PRO_CHECKOUT_URL) window.open(C.PRO_CHECKOUT_URL, '_blank');
  };
  window.closePro = function () { const m = document.getElementById('proModal'); if (m) m.classList.remove('open'); };
  // ---- Checkout (Mercado Pago through bm-payments, or a hosted checkout link) ----
  const returnUrl = () => location.origin + location.pathname;
  async function startMpCheckout(plan) {
    toast('Opening Mercado Pago…');
    try {
      const res = await payApi('/api/checkout', { method: 'POST', body: JSON.stringify({ app: PAY.app, plan: plan || 'pro', return_url: returnUrl() }) });
      if (res.init_point) { location.href = res.init_point; return true; }
      toast(res.error || 'Could not start the checkout'); return false;
    } catch (e) { toast('Network error starting the checkout'); return false; }
  }
  window.goCheckout = function () {
    track('begin_checkout', { plan: 'pro' });
    if (mpMode()) return startMpCheckout('pro');
    if (C.PRO_CHECKOUT_URL) window.open(C.PRO_CHECKOUT_URL, '_blank');
    else toast('Checkout is not available yet. Set PAYMENTS.url or PRO_CHECKOUT_URL in config.js');
  };
  window.goBundle = function () { track('begin_checkout', { plan: 'bundle' }); if (mpMode()) return startMpCheckout('bundle'); toast('Bundle checkout not configured'); };
  window.goSubscribe = async function (email) {
    email = (email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter the e-mail for your subscription'); return false; }
    track('begin_checkout', { plan: 'subscription' });
    if (!mpMode()) { toast('Subscriptions not configured'); return false; }
    toast('Opening Mercado Pago…');
    try {
      const res = await payApi('/api/subscribe', { method: 'POST', body: JSON.stringify({ email, return_url: returnUrl() }) });
      if (res.init_point) { location.href = res.init_point; return true; }
      toast(res.error || 'Could not start the subscription'); return false;
    } catch (e) { toast('Network error starting the subscription'); return false; }
  };
  // Back from Mercado Pago: ?mp=success&payment_id=… (Checkout Pro) or ?mp=subscription&preapproval_id=…
  async function handlePaymentReturn() {
    if (!mpMode()) return;
    const q = new URLSearchParams(location.search);
    const mp = q.get('mp'); if (!mp) return;
    const clean = () => { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} };
    if (mp === 'success' && q.get('payment_id') && q.get('external_reference')) {
      toast('Confirming your payment…');
      try {
        // both are required by the server: the random external_reference proves this browser made the purchase
        const qs = 'payment_id=' + encodeURIComponent(q.get('payment_id')) + '&external_reference=' + encodeURIComponent(q.get('external_reference'));
        const res = await payApi('/api/license?' + qs);
        if (res.key) { setPro(true, res.key, 'mp'); track('purchase', { provider: 'mercadopago', app: res.app }); showKeyModal(res); }
        else toast(res.error || 'Payment not confirmed yet. Check your e-mail or contact support.');
      } catch (e) { toast('Could not confirm the payment. Try again in a minute.'); }
    } else if (mp === 'subscription' && q.get('preapproval_id')) {
      toast('Confirming your subscription…');
      try {
        const res = await payApi('/api/subscription?preapproval_id=' + encodeURIComponent(q.get('preapproval_id')));
        if (res.key) { setPro(true, res.key, 'mp'); track('purchase', { provider: 'mercadopago', plan: 'subscription' }); showKeyModal(Object.assign({ title: 'Creative Pro subscription' }, res)); }
        else toast('Subscription is ' + (res.status || 'pending') + '. It will activate once authorized.');
      } catch (e) { toast('Could not confirm the subscription yet.'); }
    } else if (mp === 'pending') toast('Payment pending. Pro unlocks as soon as it is approved.');
    else if (mp === 'failure') toast('Payment was not completed.');
    clean();
  }
  function showKeyModal(res) {
    const m = document.getElementById('proModal'); if (!m) { toast('Pro activated 🎉'); return; }
    const card = m.querySelector('.card');
    const key = String(res.key || '');
    card.innerHTML = `<button class="btn btn-sm close" data-action="close-pro" aria-label="Close">✕</button>
      <h3>You're Pro 🎉</h3>
      <p>${res.title ? 'Thanks for buying <strong>' + escHTML(res.title) + '</strong>.' : 'Thanks for your purchase.'} Pro is now active on this device.</p>
      <p class="hint">Your license key (save it to activate on other devices${res.emailed ? '; we also e-mailed it to ' + escHTML(res.email) : ''}):</p>
      <p class="license-key" style="font-family:var(--mono);font-size:1rem;background:var(--surface);padding:12px 14px;border-radius:12px;word-break:break-all;user-select:all">${escHTML(key)}</p>
      <button class="btn btn-primary btn-block no-arrow" data-action="copy-text" data-arg="${escHTML(key)}">Copy key</button>`;
    m.classList.add('open');
  }
  // Prices + extra purchase options in the Pro modal, from the catalog
  async function mountCatalog() {
    if (!mpMode()) return;
    try {
      const cat = await payApi('/api/catalog?app=' + encodeURIComponent(PAY.app));
      if (cat.app && cat.app.display) {
        document.querySelectorAll('#proPrice,[data-pro-price]').forEach(el => el.textContent = cat.app.display);
      }
      const buy = document.querySelector('#proModal [data-action="checkout"]');
      if (buy && !document.getElementById('bundleBtn')) {
        buy.insertAdjacentHTML('afterend', `
          <button class="btn btn-block" id="bundleBtn" data-action="bundle" style="margin-top:8px">All tools · ${escHTML(cat.bundle && cat.bundle.display)} once</button>
          <form class="lead-form" style="margin-top:8px" data-action="subscribe" title="Creative Pro: every tool while subscribed">
            <input type="email" name="email" placeholder="you@email.com" aria-label="E-mail for subscription" required maxlength="120">
            <button class="btn" type="submit">Subscribe ${escHTML(cat.subscription && cat.subscription.display)}</button>
          </form>
          <p class="hint tiny">Pay with Mercado Pago · card, debit, account balance. Lifetime keys never expire.</p>`);
      }
      if (!cat.configured) console.warn('bm-payments: MP_ACCESS_TOKEN not configured yet');
    } catch (e) { /* catalog unavailable: keep static price */ }
  }

  // ---- Newsletter / lead capture ----
  const NL = Object.assign({ url: '', field: 'email' }, C.NEWSLETTER || {});
  function mountLead() {
    const card = document.getElementById('leadCard'); if (!card) return;
    if (!NL.url || localStorage.getItem('newsletter_subscribed') === '1') { card.remove(); return; }
    card.hidden = false;
    const input = card.querySelector('input[type=email]'); if (input && NL.field) input.name = NL.field;
  }
  window.subscribeNewsletter = async function (ev) {
    ev.preventDefault();
    const form = ev.target, btn = form.querySelector('button'), email = (form.querySelector('input[type=email]') || {}).value || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email'); return false; }
    btn.disabled = true;
    try {
      const fd = new FormData(form); fd.append('source', (C.APP_NAME || '') + ' ' + location.pathname);
      const r = await fetch(NL.url, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd, mode: 'cors' });
      if (r.ok || r.type === 'opaque') {
        localStorage.setItem('newsletter_subscribed', '1'); track('newsletter_signup', {});
        form.closest('.lead-card').innerHTML = '<h3>You\'re in 🎉</h3><p class="hint">Check your inbox to confirm your email.</p>';
      } else { toast('Could not subscribe. Please try again.'); btn.disabled = false; }
    } catch (e) { toast('Could not subscribe. Please try again.'); btn.disabled = false; }
    return false;
  };

  // ---- PWA: service worker + "Install" button (Add to Home Screen) ----
  let installEvt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  function showInstallBtn() { const b = document.getElementById('installBtn'); if (b && !isStandalone()) b.classList.remove('hidden'); }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstallBtn(); });
  window.addEventListener('appinstalled', () => { installEvt = null; const b = document.getElementById('installBtn'); if (b) b.classList.add('hidden'); track('pwa_installed', {}); toast('Installed! Find ' + (C.APP_NAME || 'the app') + ' on your home screen.'); });
  window.installApp = async function () {
    track('pwa_install_click', {});
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === 'accepted') installEvt = null; return; }
    const m = document.getElementById('proModal');
    const how = isIOS()
      ? 'On iPhone/iPad: tap <b>Share</b> (the square with an arrow) → <b>Add to Home Screen</b>.'
      : /android/i.test(navigator.userAgent)
        ? 'In Chrome: open the <b>⋮ menu</b> → <b>Add to Home screen</b> / <b>Install app</b>.'
        : 'In Chrome or Edge on desktop: click the <b>install icon</b> at the right of the address bar, or open the browser menu → <b>Install ' + (C.APP_NAME || 'app') + '</b>. Safari: File → Add to Dock.';
    if (!m) { toast('Use your browser menu → Add to Home Screen'); return; }
    const card = m.querySelector('.card');
    const prev = card.innerHTML;
    card.innerHTML = '<button class="btn btn-sm close" data-action="close-pro" aria-label="Close">✕</button><h3>Install ' + escHTML(C.APP_NAME || '') + '</h3><p>' + how + '</p><p class="hint">Works offline once installed. No app store needed.</p>';
    m.classList.add('open');
    m.addEventListener('transitionend', () => {}, { once: true });
    const restore = () => { if (!m.classList.contains('open')) { card.innerHTML = prev; renderProStatus(); document.removeEventListener('click', restore); } };
    setTimeout(() => document.addEventListener('click', restore), 0);
  };
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => { const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready. Reload to get the latest version.'); }); });
      }).catch(() => {});
      if (isIOS() && !isStandalone()) showInstallBtn(); // iOS has no beforeinstallprompt; show manual instructions
    });
  }

  // ---- Delegated actions: replaces inline onclick/onsubmit so the CSP can forbid inline scripts ----
  // <button data-action="pro" data-arg="sidebar">  ·  <form data-action="newsletter">  ·  apps register more with bmActions.on(name, fn)
  const ACTIONS = {
    'pro': arg => openPro(arg),
    'close-pro': () => closePro(),
    'theme': () => toggleTheme(),
    'install': () => installApp(),
    'checkout': () => goCheckout(),
    'bundle': () => goBundle(),
    'deactivate': () => deactivateLicense(),
    'toggle-license': () => { const r = document.getElementById('licenseRow'); if (r) { r.classList.toggle('hidden'); const i = r.querySelector('input'); if (i && !r.classList.contains('hidden')) i.focus(); } },
    'activate-license': () => { const i = document.getElementById('licenseKey'); activateLicense(i ? i.value : ''); },
    'cookie-settings': () => { if (window.bmConsent) bmConsent.open(); },
    'copy-text': arg => { if (navigator.clipboard) navigator.clipboard.writeText(arg || '').then(() => toast('Copied'), () => toast('Copy failed')); }
  };
  const SUBMITS = {
    'newsletter': (form, ev) => subscribeNewsletter(ev),
    'subscribe': form => goSubscribe(form.querySelector('input[type=email]').value)
  };
  window.bmActions = { on(name, fn) { ACTIONS[name] = fn; }, onSubmit(name, fn) { SUBMITS[name] = fn; } };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM' || !ACTIONS[el.dataset.action]) return;
    if (el.tagName === 'A' || el.type === 'submit') e.preventDefault();
    ACTIONS[el.dataset.action](el.dataset.arg, el, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-action]');
    if (!f || !SUBMITS[f.dataset.action]) return;
    e.preventDefault();
    SUBMITS[f.dataset.action](f, e);
  });

  document.addEventListener('DOMContentLoaded', () => {
    mountAds(); mountLead(); renderProStatus(); recheckLicense(); mountCatalog(); handlePaymentReturn();
    document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closePro(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePro(); });
    const lk = document.getElementById('licenseKey');
    if (lk) lk.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); activateLicense(lk.value); } });
  });
})();
