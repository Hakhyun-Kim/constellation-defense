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
