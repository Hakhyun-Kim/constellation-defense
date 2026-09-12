const DEFAULT_API_URL = 'https://api.neonpay.com';

async function fetchNeon(fetchImpl, url, options) {
  try { return await fetchImpl(url, options); }
  catch (cause) {
    const error = new Error('Neon request unavailable');
    error.status = cause.name === 'TimeoutError' ? 504 : 502;
    error.cause = cause;
    throw error;
  }
}

export async function createNeonCheckout({ apiKey, apiUrl = DEFAULT_API_URL, payload, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchNeon(fetchImpl, `${apiUrl}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Neon checkout failed (${response.status})`);
    error.status = 502;
    error.cause = data;
    throw error;
  }
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
export async function getNeonPrices({ apiKey, apiUrl = DEFAULT_API_URL, country, ip, locale, fetchImpl = fetch, timeoutMs = 3000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const query = new URLSearchParams(country ? { country } : { ip });
  if (locale) query.set('locale', locale);
  const response = await fetchImpl(`${apiUrl}/prices?${query}`, {
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Neon price lookup failed (${response.status})`);
    error.status = 502;
    error.cause = data;
    throw error;
  }
  return data;
}

export async function getNeonPurchase({ apiKey, apiUrl = DEFAULT_API_URL, purchaseId, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchNeon(fetchImpl, `${apiUrl}/purchases/${encodeURIComponent(purchaseId)}`, {
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Neon purchase lookup failed (${response.status})`);
    error.status = 502;
    error.cause = data;
    throw error;
  }
  return data;
}

/* Item-level refunds work in the sandbox; the total-refund request returns
 * 500 there — JSON {} and the documented { fee: 0 } alike, while
 * malformed bodies get a clean 400/415 (recorded upstream failure, re-verified
 * 2026-09-07; internal cause unconfirmed). The purchase object names the item id
 * `items[].id`, while this request wants it as `itemId`. Revocation itself
 * still arrives only through the signed refund.processed webhook. */
export async function createNeonRefund({ apiKey, apiUrl = DEFAULT_API_URL, purchaseId, itemId, quantity = 1, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchNeon(fetchImpl, `${apiUrl}/purchases/${encodeURIComponent(purchaseId)}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ items: [{ itemId, quantity }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Neon refund failed (${response.status})`);
    error.status = 502;
    error.cause = data;
    throw error;
  }
  return data;
}
