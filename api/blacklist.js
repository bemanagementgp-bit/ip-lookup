const { handler, json, query, validateKey } = require('../lib/http');
const { blacklist } = require('../lib/blacklist');

/** GET /api/blacklist?ip=&key= (Pro) → { ip, listed, checks:[{source,listed,detail}] } */
module.exports = handler(['GET'], async (req, res) => {
  const q = query(req);
  if (!(await validateKey(q.key))) return json(res, 402, { error: 'Blacklist checks are a Pro feature. Activate a license key to use them.', upgrade: true });
  json(res, 200, await blacklist(q.ip));
});
