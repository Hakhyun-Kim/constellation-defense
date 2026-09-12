/* Localized pricing and IP geolocation, both answered by Neon's GET /prices.
 * Neon owns localized prices — its pricing sheet converts from the USD anchor,
 * adds the market's VAT and rounds — and it geolocates an address for free, so
 * the service asks it rather than keeping a price per country or an IP
 * database of its own. Answers are remembered briefly; a failed lookup answers
 * null and the caller uses server/catalog.mjs's own rows. */
import { isCountryCode } from './catalog.mjs';
import { getNeonPrices } from './neon-client.mjs';

const TTL_MS = 10 * 60 * 1000;
/* A failed lookup is retried after a minute, not on every catalogue load. */
const FAILURE_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 500;

/* Loopback, private, shared, link-local and multicast addresses locate nobody. */
function isPublicIp(raw) {
  const ip = String(raw || '').replace(/^::ffff:/i, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  const v6 = ip.toLowerCase();
  return v6.includes(':') && !(v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6));
}

/* The address to geolocate. Behind Cloud Run the socket peer is Google's front
 * end, which appends the address it accepted the connection from to
 * X-Forwarded-For; entries before that one are whatever the client sent. So
 * the last entry is read, and only where TRUST_PROXY says such a front end
 * exists — anywhere else the header is caller-supplied and the socket is used. */
export function clientIp(req, { trustProxy = false } = {}) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const ip = trustProxy && forwarded.length ? forwarded[forwarded.length - 1] : req.socket?.remoteAddress;
  return isPublicIp(ip) ? String(ip).replace(/^::ffff:/i, '') : null;
}

/* GET /prices answers { isSupported: false, country, reason } where Neon will
 * not sell, or { isSupported: true, country, currency, isFallback,
 * prices: { <tier>: { price, localizedPrice } } }. isFallback marks Neon's
 * Global Store: a country outside its local markets, served in USD with
 * international cards. Anything else is treated as no answer. */
export function normalizePrices(data) {
  if (!data || typeof data !== 'object') return null;
  const country = isCountryCode(data.country) ? String(data.country).toUpperCase() : null;
  if (data.isSupported === false) return { supported: false, country, reason: String(data.reason || 'unsupported') };
  if (data.isSupported !== true || !country || !/^[A-Z]{3}$/.test(String(data.currency || '')) || !data.prices || typeof data.prices !== 'object') return null;
  return { supported: true, country, currency: data.currency, globalStore: data.isFallback === true, tiers: data.prices };
}

export function createPricing({ config, fetchImpl = fetch, log = console, now = Date.now }) {
  /* Mock mode never calls Neon, and without a key there is nothing to ask. */
  const enabled = !config.mock && Boolean(config.apiKey);
  const cache = new Map();

  async function lookup(key, params) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    let value = null;
    try {
      value = normalizePrices(await getNeonPrices({ apiKey: config.apiKey, apiUrl: config.apiUrl, ...params, fetchImpl }));
      if (!value) log.warn?.('[store] Neon /prices answered in an unexpected shape; using the catalogue\'s own rows');
    } catch (error) {
      /* A transport failure arrives as the generic "unavailable"; its cause carries the detail (DNS, refused, timeout). */
      const reason = error.cause?.message ? `${error.message}: ${error.cause.message}` : error.message;
      log.warn?.(`[store] Neon /prices unavailable (${reason}); using the catalogue's own rows`);
    }
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + (value ? TTL_MS : FAILURE_TTL_MS) });
    return value;
  }

  return {
    forCountry: async (country) => (enabled && isCountryCode(country) ? lookup(`country:${country}`, { country }) : null),
    forIp: async (ip) => (enabled && ip ? lookup(`ip:${ip}`, { ip }) : null),
  };
}
