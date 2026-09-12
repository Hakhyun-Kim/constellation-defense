// Generated from reviewed source windows by scripts/payment-excerpts.mjs.
export const EXCERPTS = {
  "checkout": {
    "file": "server/store-api.mjs",
    "line": 400,
    "code": "        const payload = {\n          items: [resolved.item],\n          externalReferenceId,\n          accountId,\n          languageLocale: locale === 'ko' ? 'ko-KR' : 'en-US',\n          playerCountry: country,\n          currency: resolved.currency,\n          storeUrl: origin,\n          successUrl: `${origin}/?${carried}lang=${locale}&purchase=return&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,\n          cancelUrl: `${origin}/?${carried}lang=${locale}&purchase=cancelled&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,\n        };\n        const checkout = config.mock\n          ? { checkoutId: `mock-${externalReferenceId}`, redirectUrl: `${origin}/?${carried}lang=${locale}&purchase=mock&reference=${externalReferenceId}${apiParam}` }"
  },
  "hosted": {
    "file": "server/neon-client.mjs",
    "line": 12,
    "code": "    response = await fetchImpl(`${apiUrl}${path}`, {\n      method: post ? 'POST' : 'GET',\n      headers: { 'X-API-KEY': apiKey, ...(post ? { 'Content-Type': 'application/json' } : {}) },\n      body: post ? JSON.stringify(body) : undefined,\n      signal: AbortSignal.timeout(timeoutMs),\n    });"
  },
  "fulfill": {
    "file": "server/repository.mjs",
    "line": 71,
    "code": "  async fulfill(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const pending = data.checkouts[event.externalReferenceId];\n      checkFulfillment(pending, event);\n      const refund = data.refunds[event.purchaseId];\n      if (refund) {\n        pending.status = 'refunded';\n        pending.purchaseId = event.purchaseId;\n        pending.refundedAt = refund.at;\n        data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at: refund.at };\n        return { ignored: 'purchase was refunded before fulfillment' };\n      }\n      checkAmount(pending, event);\n      const player = data.players[event.accountId] ||= { entitlements: {}, purchases: [] };\n      const at = new Date(this.now()).toISOString();\n      /* A second paid purchase of an already-granted permanent item keeps the original grant; the duplicate is recorded so it can be refunded. */\n      const duplicateGrant = Boolean(player.entitlements[pending.entitlement]);\n      if (!duplicateGrant) player.entitlements[pending.entitlement] = { grantedAt: at, purchaseId: event.purchaseId };\n      player.purchases.push(purchaseRecord(pending, event, { at, duplicateGrant }));"
  },
  "refund": {
    "file": "server/repository.mjs",
    "line": 110,
    "code": "  async revoke(event) {\n    return this.mutate((data) => {\n      if (data.processedEvents[event.eventId]) return { duplicate: true };\n      const checkout = this.findCheckout(data, event);\n      if (!checkout) {\n        // A refund may arrive before the purchase supplies the reference mapping.\n        const at = new Date(this.now()).toISOString();\n        data.refunds[event.purchaseId] = { at, refundId: event.refundId };\n        data.processedEvents[event.eventId] = { refundId: event.refundId, at };\n        return { deferred: true, revoked: false };\n      }\n      checkRefund(checkout, event);\n\n      const at = new Date(this.now()).toISOString();\n      const granted = checkout.status === 'fulfilled';\n      let revoked = false;"
  },
  "refundRequest": {
    "file": "server/store-api.mjs",
    "line": 508,
    "code": "      if (req.method === 'POST' && url.pathname === '/api/store/refund' && !config.mock && environment === 'sandbox') {\n        const input = readJson(await body(req));\n        const resolved = checkoutItem(input.sku, { locale: 'en', country: DEFAULT_COUNTRY });\n        if (!resolved) return json(res, 400, { error: 'unknown product' });\n        const accountId = account(req, res, cookieOptionsFor(req));\n        const owned = (await repository.entitlements(accountId))[resolved.entitlement];\n        if (!owned?.purchaseId) return json(res, 404, { error: 'not owned' });\n        const purchase = await getNeonPurchase({\n          apiKey: config.apiKey, apiUrl: config.apiUrl, purchaseId: owned.purchaseId, fetchImpl,\n        });\n        const item = (purchase.items || []).find((entry) => entry.sku === input.sku && entry.refundableQuantity > 0);\n        if (!item) return json(res, 409, { error: 'not refundable' });\n        const refund = await createNeonRefund({\n          apiKey: config.apiKey, apiUrl: config.apiUrl,\n          purchaseId: owned.purchaseId, itemId: item.id, fetchImpl,\n        });\n        log.info?.(`[store] refund requested for ${input.sku} (${who(accountId)}); revocation follows the webhook`);\n        return json(res, 202, { requested: true, purchaseId: owned.purchaseId, refundId: refund.refundId || refund.id || null });"
  },
  "visuals": {
    "file": "src/gfx/cosmetics.js",
    "line": 53,
    "code": "  setEntitlements(entitlements = {}) {\n    for (const [key, group] of this.groups) group.visible = Object.hasOwn(entitlements, key);\n  }"
  }
};
