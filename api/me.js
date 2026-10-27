const { handler, json, query, clientIp, isLocalRequest } = require('../lib/http');
const { lookupIp, attribution } = require('../lib/lookup');
const { normalizeIp } = require('../lib/ip');

function dec(v) { if (v == null || v === '') return null; try { return decodeURIComponent(String(v)); } catch (e) { return String(v); } }
const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);

/**
 * GET /api/me → the visitor's public IP, Vercel edge geo headers and a full lookup of that IP.
 * On localhost, ?debug_ip=8.8.8.8 simulates a visitor IP.
 */
module.exports = handler(['GET'], async (req, res) => {
  const h = req.headers || {};
  let ip = clientIp(req);
  const dbg = query(req).debug_ip;
  if (dbg && isLocalRequest(req)) { const n = normalizeIp(dbg); if (n) ip = n.ip; }
  if (!ip) return json(res, 500, { error: 'Could not determine your IP address' });
  const edge_geo = {
    country_code: h['x-vercel-ip-country'] || null,
    region: dec(h['x-vercel-ip-country-region']),
    city: dec(h['x-vercel-ip-city']),
    lat: num(h['x-vercel-ip-latitude']),
    lon: num(h['x-vercel-ip-longitude']),
    timezone: h['x-vercel-ip-timezone'] || null
  };
  const result = await lookupIp(ip, { rdap: false });
  if (result.geo && !result.geo.timezone && edge_geo.timezone && !dbg) result.geo.timezone = edge_geo.timezone;
  json(res, 200, { ip, version: result.version, edge_geo: Object.values(edge_geo).some(v => v != null) ? edge_geo : null, result, attribution: attribution(false) });
});
