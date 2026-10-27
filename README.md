# IP Lookup – What Is My IP Address

Free "what is my IP" + IP/domain lookup: approximate location, ISP/ASN, reverse DNS, RDAP network owner and abuse contact, Tor exit check and datacenter/VPN heuristics. Pro adds batch lookups (up to 1,000 IPs), blacklist/reputation checks and CSV/JSON export.

**Live URL:** https://__SITE_URL__/ (placeholder, replaced after the first deploy)

Unlike the other mini apps this one is a static site **plus Vercel Node functions** in the same project (`api/*.js`, CommonJS). It has npm dependencies (`maxmind` and two MMDB packages), so Vercel runs `npm install` on deploy.

## Structure

```
index.html privacy.html terms.html styles.css app.js monetize.js config.js favicon.svg robots.txt sitemap.xml vercel.json
api/me.js         GET  /api/me                → visitor IP, Vercel edge geo headers, full lookup (localhost: ?debug_ip=8.8.8.8)
api/lookup.js     GET  /api/lookup?q=         → IP, hostname or URL (max 4 resolved addresses), includes RDAP
api/batch.js      POST /api/batch {ips,key?}  → free ≤10, Pro ≤1000 (402 {upgrade:true} over the free limit), no RDAP
api/blacklist.js  GET  /api/blacklist?ip=&key= → Pro only (402 otherwise)
lib/ip.js         parsing/normalisation, special ranges (RFC1918, CGNAT, loopback, docs, ULA…), DNSBL names
lib/geo.js        lazy MMDB readers (v4/v6 opened only when needed) + field mapping
lib/net.js        reverse DNS (2 s), A/AAAA resolution, RDAP via rdap.org (3 s), cached Tor (1 h) / Feodo (6 h) lists
lib/classify.js   datacenter / VPN keyword heuristics on the ASN org + reverse DNS
lib/blacklist.js  DNSBLs + Feodo Tracker + Tor
lib/http.js       JSON (Cache-Control: no-store), client IP, 60 req/min in-memory rate limit, license validation
dev-server.js     local server (static + /api routing). Not deployed (.vercelignore)
test/*.test.js    node test/run.js  (or each file with node)
```

## Data sources & licences (attribution is REQUIRED)

| Data | Source | Licence | Where credited |
|---|---|---|---|
| City geolocation | DB-IP Lite via `@ip-location-db/dbip-city-mmdb` | CC BY 4.0 | "IP geolocation by DB-IP" + link to https://db-ip.com next to every result, batch table, CSV/JSON export, footer, privacy page |
| ASN | RouteViews / DB-IP via `@ip-location-db/asn-mmdb` | CC BY 4.0 | same places |
| Network owner | RDAP (rdap.org → RIRs) | public registry data | result attribution |
| Tor exits | check.torproject.org/torbulkexitlist | public | blacklist results |
| Botnet C2 | abuse.ch Feodo Tracker | CC0 | blacklist results |
| DNSBLs | SpamCop, PSBL (env `DNSBL_ZONES`) | see each list | blacklist results |

Spamhaus is intentionally **not** used (free tier is non-commercial). **Before going live, review the terms of every DNSBL in `DNSBL_ZONES`** (query volume limits, commercial use, whether public resolvers are allowed). Some lists refuse queries coming through big public resolvers; the check then reports `n/a`.

MMDB record mapping (both DBs are flat):
- city DB: `country_code`, `state1` → region, `city`, `latitude`/`longitude` (rounded to 4 decimals), `timezone` (empty in the Lite DB → `null`; `/api/me` falls back to Vercel's `x-vercel-ip-timezone`). Country name comes from `Intl.DisplayNames`.
- ASN DB: `autonomous_system_number` → `asn.number`, `autonomous_system_organization` → `asn.org`.

**Keep the databases fresh:** the packages are updated regularly. Run `npm update @ip-location-db/dbip-city-mmdb @ip-location-db/asn-mmdb` monthly and redeploy.

## Environment variables (all optional)

| Var | Default | Purpose |
|---|---|---|
| `DNSBL_ZONES` | `bl.spamcop.net,psbl.surriel.com` | comma-separated DNSBL zones for `/api/blacklist` |
| `PAYMENTS_URL` | `https://bm-payments.vercel.app` | license validation service |
| `PAYMENTS_APP` | `iplookup` | catalog key |
| `PRO_TEST_KEYS` | – | comma-separated keys accepted without calling bm-payments (local testing only; don't set in production) |
| `RATE_LIMIT_PER_MIN` | `60` | per-IP, per function instance |
| `DNS_SERVERS` | system | custom resolvers (e.g. `1.1.1.1,8.8.8.8`) |

## Privacy

Queried IPs are never logged or stored. The rate limiter keeps an in-memory counter per visitor IP for 60 s. History lives in the visitor's localStorage. API responses are `Cache-Control: no-store` and same-origin (no CORS headers).

## Run locally

```
npm install
node dev-server.js            # http://localhost:5188  (try /?debug_ip=8.8.8.8)
PRO_TEST_KEYS=TEST-PRO node dev-server.js   # then store TEST-PRO as pro_license_key + pro_license=1 in localStorage to test Pro
node test/run.js
```

## Deploy

`vercel --prod` from this folder (or the repo's `deploy.sh`). `vercel.json` sets `maxDuration: 10`, `memory: 1024` and `includeFiles: node_modules/@ip-location-db/**/*.mmdb` so the databases ship with the functions (~150 MB uncompressed, under the 250 MB function limit). Then replace `__SITE_URL__` with the real domain in all files.

## Monetize

1. **Pro license** – already wired to Mercado Pago via `bm-payments` (`PAYMENTS.app = "iplookup"`, catalog entry exists). The server re-validates keys for `/api/batch` (>10 IPs) and `/api/blacklist`, so the gate cannot be bypassed from the browser. Valid keys are cached 1 h per instance.
2. **AdSense** – set `ADSENSE_CLIENT` in `config.js`; slots: `sidebar-1`, `sidebar-2`, `below-tool`.
3. **Analytics** – set `GA_ID`.
4. **Affiliates** – VPN affiliate programs fit the "How to hide your IP" section; keep the wording neutral and label sponsored links.
5. **Newsletter** – set `NEWSLETTER.url`; `apply-brand.js` injects the lead card.
