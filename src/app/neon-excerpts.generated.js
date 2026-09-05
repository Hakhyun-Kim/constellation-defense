// Generated from reviewed source windows by scripts/payment-excerpts.mjs.
export const EXCERPTS = {
  "checkout": {
    "file": "server/store-api.mjs",
    "line": 314,
    "code": "        const payload = {\n          items: [resolved.item],\n          externalReferenceId,\n          accountId,\n          languageLocale: locale === 'ko' ? 'ko-KR' : 'en-US',\n          playerCountry: country,\n          currency: resolved.currency,\n          storeUrl: origin,\n          successUrl: `${origin}/?lang=${locale}&purchase=return&sku=${encodeURIComponent(resolved.item.sku)}`,\n          cancelUrl: `${origin}/?lang=${locale}&purchase=cancelled&sku=${encodeURIComponent(resolved.item.sku)}`,\n        };\n        const checkout = config.mock\n          ? { checkoutId: `mock-${externalReferenceId}`, redirectUrl: `${origin}/?lang=${locale}&purchase=mock&reference=${externalReferenceId}` }"
  },
  "hosted": {
    "file": "server/neon-client.mjs",
    "line": 5,
    "code": "  const response = await fetchImpl(`${apiUrl}/checkout`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },\n    body: JSON.stringify(payload),\n    signal: AbortSignal.timeout(timeoutMs),\n  });"
  },
  "fulfill": {
    "file": "server/repository.mjs",
    "line": 80,
    "code": "  async fulfill(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const pending = data.checkouts[event.externalReferenceId];\n      if (!pending) throw new PermanentRejection('unknown checkout reference');\n      /* Event replay was handled above. A new event referencing a processed or refunded intent must also be rejected so late delivery cannot reverse a refund. */\n      if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);\n      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');\n      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');\n      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');\n      const refund = data.refunds[event.purchaseId];\n      if (refund) {\n        pending.status = 'refunded';\n        pending.purchaseId = event.purchaseId;\n        pending.refundedAt = refund.at;\n        data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at: refund.at };\n        return { ignored: 'purchase was refunded before fulfillment' };\n      }\n      /* Compare prices only when settlement currency matches the original checkout currency. Neon-converted amounts are recorded rather than compared directly. */\n      if (event.currency && event.currency === pending.currency && event.price != null && event.price !== pending.price) {"
  },
  "refund": {
    "file": "server/repository.mjs",
    "line": 133,
    "code": "  async revoke(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const checkout = this.findCheckout(data, event);\n      if (!checkout) {\n        // A refund may arrive before the purchase supplies the reference mapping.\n        const at = new Date(this.now()).toISOString();\n        data.refunds[event.purchaseId] = { at, refundId: event.refundId };\n        data.processedEvents[event.eventId] = { refundId: event.refundId, at };\n        return { deferred: true, revoked: false };\n      }\n      if (event.accountId && checkout.accountId !== event.accountId) {\n        throw new PermanentRejection('account does not match checkout');\n      }\n      if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');\n      if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');"
  },
  "visuals": {
    "file": "src/gfx/cosmetics.js",
    "line": 53,
    "code": "  setEntitlements(entitlements = {}) {\n    for (const [key, group] of this.groups) group.visible = Object.hasOwn(entitlements, key);\n  }"
  }
};
