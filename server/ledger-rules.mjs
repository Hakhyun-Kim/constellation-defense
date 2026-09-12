/* Payment rules shared by the JSON and Firestore ledgers. Each ledger owns only how it reads and writes; the decisions live here once so the two cannot drift. Nothing here mutates its arguments: Firestore hands in snapshot data. */

/* Prune unpaid intents and old deduplication records after 30 days to bound file growth. Retention must comfortably exceed Neon's 36-hour retry window. Declared once so the JSON and Firestore ledgers cannot drift apart on how long a retry can still find its intent. */
export const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* Permanent rejections are acknowledged with 200 and logged because retries cannot fix them. Disk/database failures propagate as 5xx so Neon retries. */
export class PermanentRejection extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'PermanentRejection';
    this.reason = reason;
  }
}

/* Event replay is deduplicated by the caller before this runs. A new event referencing a processed or refunded intent must also be rejected so late delivery cannot reverse a refund: a fulfilment that lands after the refund must not restore revoked ownership. */
export function checkFulfillment(pending, event) {
  if (!pending) throw new PermanentRejection('unknown checkout reference');
  if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);
  if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
  if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
  if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');
}

const settledCurrency = (event) => event.settledCurrency ?? event.currency ?? null;

/* Item prices arrive in the settled currency. Compare only when it matches the checkout currency; after a country switch on the hosted page the converted amount is recorded, not compared. A tier-priced checkout has no price of ours (null): Neon set the amount, so there is nothing to compare. */
export function checkAmount(pending, event) {
  const settled = settledCurrency(event);
  if (settled && settled === pending.currency && event.price != null && pending.price != null && event.price !== pending.price) {
    throw new PermanentRejection('amount does not match checkout');
  }
}

export function purchaseRecord(pending, event, { at, duplicateGrant }) {
  const settled = settledCurrency(event);
  return {
    purchaseId: event.purchaseId,
    orderNumber: event.orderNumber,
    sku: event.sku,
    price: event.price ?? pending.price,
    currency: settled ?? pending.currency,
    currencySwitched: Boolean(settled && settled !== pending.currency),
    duplicateGrant,
    at,
  };
}

export function checkRefund(checkout, event) {
  if (event.accountId && checkout.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
  if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
  if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');
}

/* When the granting purchase is refunded, the grant moves to the earliest remaining paid purchase of the same item, or null when none is left. Ordered by time then purchase id so both ledgers pick the same one whatever order they read in. */
export function replacementGrant(purchases, checkout) {
  const replacement = purchases
    .filter((entry) => entry.sku === checkout.sku && entry.purchaseId !== checkout.purchaseId && !entry.refundedAt)
    .sort((a, b) => a.at.localeCompare(b.at) || a.purchaseId.localeCompare(b.purchaseId))[0];
  return replacement ? { grantedAt: replacement.at, purchaseId: replacement.purchaseId } : null;
}
