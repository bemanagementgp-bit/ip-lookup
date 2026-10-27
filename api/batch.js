const { handler, json, body, validateKey } = require('../lib/http');
const { lookupIp, attribution } = require('../lib/lookup');

const FREE_MAX = 10, PRO_MAX = 1000, CONCURRENCY = 24, RDNS_BUDGET_MS = 6000;

/**
 * POST /api/batch { ips:[...], key? } → { count, results:[...], attribution }
 * No RDAP. Free: up to 10 IPs. Pro (valid license key): up to 1000. Reverse DNS is skipped once
 * the time budget is spent so large batches finish within the function limit.
 */
module.exports = handler(['POST'], async (req, res) => {
  const b = body(req);
  let list = b.ips;
  if (typeof list === 'string') list = list.split(/[\s,;]+/);
  if (!Array.isArray(list)) return json(res, 400, { error: 'Send {"ips": ["1.2.3.4", ...]}' });
  const ips = [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];
  if (!ips.length) return json(res, 400, { error: 'No IP addresses provided' });
  if (ips.length > PRO_MAX) return json(res, 400, { error: `Maximum ${PRO_MAX} IPs per batch` });
  const pro = ips.length > FREE_MAX ? await validateKey(b.key) : false;
  if (ips.length > FREE_MAX && !pro) return json(res, 402, { error: `Free batch lookups are limited to ${FREE_MAX} IPs. Upgrade to Pro for up to ${PRO_MAX}.`, upgrade: true, limit: FREE_MAX });

  const start = Date.now();
  const results = new Array(ips.length);
  let i = 0;
  async function worker() {
    while (i < ips.length) {
      const k = i++;
      results[k] = await lookupIp(ips[k], { rdap: false, rdns: Date.now() - start < RDNS_BUDGET_MS });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ips.length) }, worker));
  json(res, 200, { count: results.length, results, attribution: attribution(false) });
});
