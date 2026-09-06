// Generated from reviewed source windows by scripts/payment-excerpts.mjs.
export const EXCERPTS = {
  "checkout": {
    "file": "server/store-api.mjs",
    "line": 344,
    "code": "        const payload = {\n          items: [resolved.item],\n          externalReferenceId,\n          accountId,\n          languageLocale: locale === 'ko' ? 'ko-KR' : 'en-US',\n          playerCountry: country,\n          currency: resolved.currency,\n          storeUrl: origin,\n          successUrl: `${origin}/?${carried}lang=${locale}&purchase=return&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,\n          cancelUrl: `${origin}/?${carried}lang=${locale}&purchase=cancelled&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,\n        };\n        const checkout = config.mock\n          ? { checkoutId: `mock-${externalReferenceId}`, redirectUrl: `${origin}/?${carried}lang=${locale}&purchase=mock&reference=${externalReferenceId}${apiParam}` }"
  },
  "hosted": {
    "file": "server/neon-client.mjs",
    "line": 5,
    "code": "  const response = await fetchImpl(`${apiUrl}/checkout`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },\n    body: JSON.stringify(payload),\n    signal: AbortSignal.timeout(timeoutMs),\n  });"
  },
  "fulfill": {
    "file": "server/repository.mjs",
    "line": 80,
    "code": "  async fulfill(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const pending = data.checkouts[event.externalReferenceId];\n      if (!pending) throw new PermanentRejection('unknown checkout reference');\n      /* Event replay was handled above. A new event referencing a processed or refunded intent must also be rejected so late delivery cannot reverse a refund. */\n      if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);\n      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');\n      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');\n      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');\n      const refund = data.refunds[event.purchaseId];\n      if (refund) {\n        pending.status = 'refunded';\n        pending.purchaseId = event.purchaseId;\n        pending.refundedAt = refund.at;\n        data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at: refund.at };\n        return { ignored: 'purchase was refunded before fulfillment' };\n      }\n      /* Item prices arrive in the settled currency. Compare only when it matches the checkout currency; after a country switch on the hosted page the converted amount is recorded, not compared. */\n      const settled = event.settledCurrency ?? event.currency ?? null;"
  },
  "refund": {
    "file": "server/repository.mjs",
    "line": 137,
    "code": "  async revoke(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const checkout = this.findCheckout(data, event);\n      if (!checkout) {\n        // A refund may arrive before the purchase supplies the reference mapping.\n        const at = new Date(this.now()).toISOString();\n        data.refunds[event.purchaseId] = { at, refundId: event.refundId };\n        data.processedEvents[event.eventId] = { refundId: event.refundId, at };\n        return { deferred: true, revoked: false };\n      }\n      if (event.accountId && checkout.accountId !== event.accountId) {\n        throw new PermanentRejection('account does not match checkout');\n      }\n      if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');\n      if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');"
  },
  "refundRequest": {
    "file": "server/store-api.mjs",
    "line": 432,
    "code": "      if (req.method === 'POST' && url.pathname === '/api/store/refund' && !config.mock) {\n        const input = readJson(await body(req));\n        const resolved = checkoutItem(input.sku, { locale: 'en', country: DEFAULT_COUNTRY });\n        if (!resolved) return json(res, 400, { error: 'unknown product' });\n        const accountId = account(req, res, cookieOptionsFor(req));\n        const owned = (await repository.entitlements(accountId))[resolved.entitlement];\n        if (!owned?.purchaseId) return json(res, 404, { error: 'not owned' });\n        const purchase = await getNeonPurchase({\n          apiKey: config.apiKey, apiUrl: config.apiUrl, purchaseId: owned.purchaseId, fetchImpl,\n        });\n        const item = (purchase.items || []).find((entry) => entry.sku === input.sku && entry.refundableQuantity > 0);\n        if (!item) return json(res, 409, { error: 'not refundable' });\n        const refund = await createNeonRefund({\n          apiKey: config.apiKey, apiUrl: config.apiUrl,\n          purchaseId: owned.purchaseId, itemId: item.id, fetchImpl,\n        });\n        log.info?.(`[store] refund requested for ${input.sku} (${who(accountId)}); revocation follows the webhook`);\n        return json(res, 202, { requested: true, refundId: refund.refundId || refund.id || null });"
  },
  "visuals": {
    "file": "src/gfx/cosmetics.js",
    "line": 53,
    "code": "  setEntitlements(entitlements = {}) {\n    for (const [key, group] of this.groups) group.visible = Object.hasOwn(entitlements, key);\n  }"
  }
};
