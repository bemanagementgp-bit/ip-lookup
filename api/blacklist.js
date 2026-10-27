const { handler, json, query, body, licenseKey, validateKey } = require('../lib/http');
const { blacklist } = require('../lib/blacklist');

/**
 * Blacklist / reputation check (Pro) → { ip, listed, checks:[{source,listed,detail}] }
 *   GET  /api/blacklist?ip=1.2.3.4   with header  X-License-Key: <key>   (preferred)
 *   POST /api/blacklist  {"ip":"1.2.3.4","key":"<key>"}
 * The license key is read from the X-License-Key header or the JSON body so it never ends up in
 * URLs / access logs. `?key=` in the query string is still accepted as a deprecated fallback for
 * old cached front-ends; the current front-end no longer sends it.
 */
module.exports = handler(['GET', 'POST'], async (req, res) => {
  const q = query(req), b = req.method === 'POST' ? body(req) : {};
  const key = licenseKey(req, b, q);
  if (!(await validateKey(key))) return json(res, 402, { error: 'Blacklist checks are a Pro feature. Activate a license key to use them.', upgrade: true });
  const ip = b.ip != null ? b.ip : q.ip;
  if (typeof ip !== 'string' || !ip.trim() || ip.length > 64) return json(res, 400, { error: 'Not a valid IP address' });
  json(res, 200, await blacklist(ip));
});
