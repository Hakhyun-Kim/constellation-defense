const DEFAULT_API_URL = 'https://api.neonpay.com';

/* One Neon call. Transport failures (DNS, refused, the timeout's abort) become
 * 502/504 so a route answers "Neon unavailable" and not "our bug"; a non-2xx
 * answer is 502 with Neon's body as the cause. A body — even an empty one —
 * makes it a POST; only its absence makes a GET. */
async function neonRequest(label, { apiKey, apiUrl = DEFAULT_API_URL, fetchImpl = fetch, timeoutMs = 10000 }, path, body) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const post = body !== undefined;
  let response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      method: post ? 'POST' : 'GET',
      headers: { 'X-API-KEY': apiKey, ...(post ? { 'Content-Type': 'application/json' } : {}) },
      body: post ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw Object.assign(new Error('Neon request unavailable'), { status: cause.name === 'TimeoutError' ? 504 : 502, cause });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`Neon ${label} failed (${response.status})`), { status: 502, cause: data });
  return data;
}

export async function createNeonCheckout({ payload, ...client }) {
  const data = await neonRequest('checkout', client, '/checkout', payload);
  // This adapter initiates Hosted Checkout; token-only responses cannot be opened.
  if (typeof data.redirectUrl !== 'string' || !/^https:\/\//.test(data.redirectUrl)) {
    throw Object.assign(new Error('Neon returned an incomplete hosted checkout'), { status: 502 });
  }
  return data;
}

/* Neon's localized pricing: its pricing sheet's tiers for one country, or for
 * the country Neon geolocates an IP address to (GET /prices, country or ip).
 * Read-only, so it runs on catalogue loads; the short timeout is because the
 * store falls back to its own table when this does not answer. */
export async function getNeonPrices({ country, ip, locale, timeoutMs = 3000, ...client }) {
  const query = new URLSearchParams(country ? { country } : { ip });
  if (locale) query.set('locale', locale);
  return neonRequest('price lookup', { ...client, timeoutMs }, `/prices?${query}`);
}

export async function getNeonPurchase({ purchaseId, ...client }) {
  return neonRequest('purchase lookup', client, `/purchases/${encodeURIComponent(purchaseId)}`);
}

/* Item-level refunds work in the sandbox; the total-refund request returns
 * 500 there — JSON {} and the documented { fee: 0 } alike, while
 * malformed bodies get a clean 400/415 (recorded upstream failure, re-verified
 * 2026-09-07; internal cause unconfirmed). The purchase object names the item id
 * `items[].id`, while this request wants it as `itemId`. Revocation itself
 * still arrives only through the signed refund.processed webhook. */
export async function createNeonRefund({ purchaseId, itemId, quantity = 1, ...client }) {
  return neonRequest('refund', client, `/purchases/${encodeURIComponent(purchaseId)}/refund`, { items: [{ itemId, quantity }] });
}
