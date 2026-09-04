const DEFAULT_API_URL = 'https://api.neonpay.com';

export async function createNeonCheckout({ apiKey, apiUrl = DEFAULT_API_URL, payload, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('NEON_API_KEY is not configured');
  const response = await fetchImpl(`${apiUrl}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Neon checkout failed (${response.status})`);
    error.status = 502;
    error.cause = data;
    throw error;
  }
  if (!data.redirectUrl && !(data.checkoutId && data.token)) throw new Error('Neon returned an incomplete checkout');
  return data;
}
