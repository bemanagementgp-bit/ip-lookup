/**
 * Local dev server: serves the static files and routes /api/<name> to api/<name>.js with
 * Vercel-like req.query / req.body / res.status().json() helpers.
 * Usage: node dev-server.js [port]   (default 5188)   Env: PRO_TEST_KEYS=KEY1,KEY2 for local Pro tests.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 5188);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function enhance(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.send = b => { res.end(b); return res; };
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size < 5e6) chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (/json/.test(req.headers['content-type'] || '')) { try { return resolve(JSON.parse(raw || '{}')); } catch (e) { return resolve(raw); } }
      resolve(raw);
    });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '');
      const file = path.join(ROOT, 'api', name + '.js');
      if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
      enhance(req, res, url);
      if (req.method === 'POST' || req.method === 'PUT') req.body = await readBody(req);
      return await require(file)(req, res);
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    let file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || /node_modules|[\\/]\./.test(path.relative(ROOT, file))) { res.statusCode = 403; return res.end('Forbidden'); }
    if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html'; // cleanUrls
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"Dev server error"}'); }
  }
}).listen(PORT, () => console.log(`IP Lookup dev server on http://localhost:${PORT}`));
