/**
 * Helpers for the Vercel Node functions: JSON responses (no-store), body parsing, client IP,
 * in-memory rate limit (60 req/min per IP, per function instance) and Pro key validation.
 * Same-origin API: no CORS headers are sent. Queried IPs are never logged or stored.
 */
const { fetchWithTimeout } = require('./net');
const { normalizeIp } = require('./ip');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body || '{}')); } catch (e) { return {}; }
}

function query(req) {
  if (req.query) return req.query;
  try { return Object.fromEntries(new URL(req.url, 'http://x').searchParams); } catch (e) { return {}; }
}

/** Visitor IP: first x-forwarded-for entry, then x-real-ip, then the socket. */
function clientIp(req) {
  const h = req.headers || {};
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  const cand = xff || String(h['x-real-ip'] || '').trim() || (req.socket && req.socket.remoteAddress) || '';
  const n = normalizeIp(cand);
  return n ? n.ip : null;
}

function isLocalRequest(req) {
  const host = String((req.headers || {}).host || '').toLowerCase().replace(/:\d+$/, '');
  return (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && !['production', 'preview'].includes(process.env.VERCEL_ENV);
}

// ---- rate limit: fixed 60 s window per client IP ----
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const hits = new Map();
function rateLimited(req, res) {
  const ip = clientIp(req) || 'unknown';
  const now = Date.now();
  let e = hits.get(ip);
  if (!e || now - e.start >= 60000) { e = { start: now, n: 0 }; hits.set(ip, e); }
  e.n++;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= 60000) hits.delete(k);
  res.setHeader('X-RateLimit-Limit', String(LIMIT));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, LIMIT - e.n)));
  if (e.n > LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((e.start + 60000 - now) / 1000)));
    json(res, 429, { error: 'Too many requests. Please wait a minute and try again.' });
    return true;
  }
  return false;
}

// ---- Pro license validation through bm-payments (valid keys cached 1 h, invalid 5 min) ----
const PAYMENTS_URL = (process.env.PAYMENTS_URL || 'https://bm-payments.vercel.app').replace(/\/$/, '');
const APP_KEY = process.env.PAYMENTS_APP || 'iplookup';
const keyCache = new Map();
async function validateKey(key) {
  key = String(key || '').trim();
  if (!key || key.length > 200) return false;
  const test = (process.env.PRO_TEST_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (test.includes(key)) return true;
  const c = keyCache.get(key);
  if (c && c.until > Date.now()) return c.valid;
  let valid = false;
  try {
    const r = await fetchWithTimeout(PAYMENTS_URL + '/api/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key, app: APP_KEY })
    }, 4000);
    const d = await r.json().catch(() => ({}));
    valid = !!d.valid;
  } catch (e) { valid = false; }
  keyCache.set(key, { valid, until: Date.now() + (valid ? 3600e3 : 300e3) });
  if (keyCache.size > 2000) keyCache.delete(keyCache.keys().next().value);
  return valid;
}

/** Wraps a handler: method check, rate limit, errors → JSON (without echoing input). */
function handler(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return json(res, 405, { error: 'Method not allowed' }); }
    if (rateLimited(req, res)) return;
    try { await fn(req, res); }
    catch (e) { json(res, e.status || 500, { error: e.status ? e.message : 'Internal error' }); }
  };
}

module.exports = { json, body, query, clientIp, isLocalRequest, rateLimited, validateKey, handler };
