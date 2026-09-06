const DEFAULT_API_URL = 'https://api.neonpay.com';

export async function createNeonCheckout({ apiKey, apiUrl = DEFAULT_API_URL, payload, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchImpl(`${apiUrl}/checkout`, {
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
    throw new Error('Neon returned an incomplete hosted checkout');
  }
  return data;
}

export async function getNeonPurchase({ apiKey, apiUrl = DEFAULT_API_URL, purchaseId, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchImpl(`${apiUrl}/purchases/${encodeURIComponent(purchaseId)}`, {
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
 * 500 there — the empty body and the documented { fee: 0 } alike, while
 * malformed bodies get a clean 400/415 (recorded vendor defect, re-verified
 * 2026-09-07). The purchase object names the item id
 * `items[].id`, while this request wants it as `itemId`. Revocation itself
 * still arrives only through the signed refund.processed webhook. */
export async function createNeonRefund({ apiKey, apiUrl = DEFAULT_API_URL, purchaseId, itemId, quantity = 1, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchImpl(`${apiUrl}/purchases/${encodeURIComponent(purchaseId)}/refund`, {
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
