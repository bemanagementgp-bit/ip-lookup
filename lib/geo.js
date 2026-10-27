/**
 * Offline geolocation + ASN from MMDB files shipped in npm packages:
 *  - @ip-location-db/dbip-city-mmdb  (DB-IP Lite, CC BY 4.0)  record: {city,country_code,state1,state2,postcode,latitude,longitude,timezone}
 *  - @ip-location-db/asn-mmdb         (RouteViews / DB-IP, CC BY 4.0) record: {autonomous_system_number,autonomous_system_organization}
 * Readers are opened lazily (v4 or v6 only when needed) and cached for the lifetime of the function instance.
 */
const path = require('path');
const maxmind = require('maxmind');

const dir = pkg => path.dirname(require.resolve(pkg + '/package.json'));
const FILES = {
  city4: () => path.join(dir('@ip-location-db/dbip-city-mmdb'), 'dbip-city-ipv4.mmdb'),
  city6: () => path.join(dir('@ip-location-db/dbip-city-mmdb'), 'dbip-city-ipv6.mmdb'),
  asn: () => path.join(dir('@ip-location-db/asn-mmdb'), 'asn.mmdb')
};
const readers = {};
function reader(name) {
  if (!readers[name]) readers[name] = maxmind.open(FILES[name](), { cache: { max: 2000 }, watchForUpdates: false })
    .catch(e => { delete readers[name]; throw e; });
  return readers[name];
}

let regionNames = null;
function countryName(code) {
  if (!code) return null;
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) || code;
  } catch (e) { return code; }
}

const ACCURACY_NOTE = 'Approximate: city/region level from a public database. It shows where the network is registered or routed, not a street address or a person.';

/** @returns {Promise<{country_code,country,region,city,lat,lon,timezone,accuracy_note}|null>} */
async function geo(ip, version) {
  const r = await reader(version === 6 ? 'city6' : 'city4');
  const rec = r.get(ip);
  if (!rec) return null;
  const round = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1e4) / 1e4 : null;
  return {
    country_code: rec.country_code || null,
    country: countryName(rec.country_code),
    region: rec.state1 || null,
    city: rec.city || null,
    lat: round(rec.latitude),
    lon: round(rec.longitude),
    timezone: rec.timezone || null,
    accuracy_note: ACCURACY_NOTE
  };
}

/** @returns {Promise<{number,org}|null>} */
async function asn(ip) {
  const r = await reader('asn');
  const rec = r.get(ip);
  if (!rec || !rec.autonomous_system_number) return null;
  return { number: rec.autonomous_system_number, org: rec.autonomous_system_organization || null };
}

const ATTRIBUTION = [
  { text: 'IP geolocation by DB-IP', url: 'https://db-ip.com', license: 'CC BY 4.0' },
  { text: 'ASN data: RouteViews / DB-IP', url: 'https://github.com/sapics/ip-location-db', license: 'CC BY 4.0' }
];

module.exports = { geo, asn, countryName, ATTRIBUTION, ACCURACY_NOTE };
