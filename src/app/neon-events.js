// The inspector observes sanitized facts; it cannot grant game entitlements.
const listeners = new Set();
export function observePayments(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function paymentEvent(type, detail = {}) {
  for (const listener of listeners) listener({ type, ...detail });
}

// Never put bearer credentials, hosted tokens or account transfer codes in logs.
export function redactPayment(value) {
  if (Array.isArray(value)) return value.map(redactPayment);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, /token|playerId|accountId|code|authorization|redirectUrl/i.test(key)
      ? '[redacted]' : redactPayment(entry)]));
  return value;
}
