const { handler, json, query } = require('../lib/http');
const { lookupIp, resolveQuery, attribution } = require('../lib/lookup');

/**
 * GET /api/lookup?q=<ip|hostname|url>
 * → { query, host?, results:[{ip,version,special?,geo,asn,reverse_dns,network,flags}], attribution }
 */
module.exports = handler(['GET'], async (req, res) => {
  const q = String(query(req).q || '').trim();
  const parsed = await resolveQuery(q);
  if (parsed.error) return json(res, parsed.status, { error: parsed.error });
  const results = await Promise.all(parsed.ips.map(x => lookupIp(x.ip, { rdap: true })));
  json(res, 200, Object.assign({ query: q }, parsed.host ? { host: parsed.host } : {}, { results, attribution: attribution(true) }));
});
