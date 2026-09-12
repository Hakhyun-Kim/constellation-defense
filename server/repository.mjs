import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EVENT_TTL_MS, PENDING_TTL_MS, checkAmount, checkFulfillment, checkRefund, purchaseRecord, replacementGrant } from './ledger-rules.mjs';

/* The rules live in ledger-rules.mjs; the class is re-exported so the webhook route keeps importing it from here. */
export { PermanentRejection } from './ledger-rules.mjs';

const EMPTY = () => ({ checkouts: {}, players: {}, processedEvents: {}, transfers: {}, saves: {}, refunds: {} });

export class JsonRepository {
  constructor(path, { now = () => Date.now() } = {}) {
    this.path = path;
    this.now = now;
    this.data = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = { ...EMPTY(), ...parsed };
      for (const key of Object.keys(EMPTY())) {
        if (!this.data[key] || typeof this.data[key] !== 'object') this.data[key] = {};
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = EMPTY();
    }
    return this.data;
  }

  prune(data) {
    const cutoffPending = this.now() - PENDING_TTL_MS;
    const cutoffEvents = this.now() - EVENT_TTL_MS;
    for (const [reference, record] of Object.entries(data.checkouts)) {
      if (record.status === 'pending' && Date.parse(record.createdAt || 0) < cutoffPending) {
        delete data.checkouts[reference];
      }
    }
    for (const [eventId, record] of Object.entries(data.processedEvents)) {
      if (Date.parse(record?.at || 0) < cutoffEvents) delete data.processedEvents[eventId];
    }
  }

  async mutate(operation) {
    const run = this.queue.then(async () => {
      // Publish only a committed snapshot: a failed write must remain retryable.
      const data = structuredClone(await this.load());
      const result = operation(data);
      this.prune(data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2));
      await rename(temporary, this.path);
      this.data = data;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async recordCheckout(record) {
    return this.mutate((data) => {
      data.checkouts[record.externalReferenceId] = { ...record, createdAt: new Date(this.now()).toISOString() };
      return data.checkouts[record.externalReferenceId];
    });
  }

  /* Real webhooks and mock confirmation share this sole fulfillment entry point. */
  async fulfill(event) {
    return this.mutate((data) => {
      if (data.processedEvents[event.eventId]) return { duplicate: true };
      const pending = data.checkouts[event.externalReferenceId];
      checkFulfillment(pending, event);
      const refund = data.refunds[event.purchaseId];
      if (refund) {
        pending.status = 'refunded';
        pending.purchaseId = event.purchaseId;
        pending.refundedAt = refund.at;
        data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at: refund.at };
        return { ignored: 'purchase was refunded before fulfillment' };
      }
      checkAmount(pending, event);
      const player = data.players[event.accountId] ||= { entitlements: {}, purchases: [] };
      const at = new Date(this.now()).toISOString();
      /* A second paid purchase of an already-granted permanent item keeps the original grant; the duplicate is recorded so it can be refunded. */
      const duplicateGrant = Boolean(player.entitlements[pending.entitlement]);
      if (!duplicateGrant) player.entitlements[pending.entitlement] = { grantedAt: at, purchaseId: event.purchaseId };
      player.purchases.push(purchaseRecord(pending, event, { at, duplicateGrant }));
      data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at };
      pending.status = 'fulfilled';
      pending.purchaseId = event.purchaseId;
      return { duplicate: false };
    });
  }

  async pendingCheckout(reference) {
    return (await this.load()).checkouts[reference] || null;
  }

  /* Refund references can be null, so support both externalReferenceId and purchaseId lookup. */
  findCheckout(data, { externalReferenceId, purchaseId }) {
    if (externalReferenceId && data.checkouts[externalReferenceId]) return data.checkouts[externalReferenceId];
    if (!purchaseId) return null;
    return Object.values(data.checkouts).find((record) => record.purchaseId === purchaseId) || null;
  }

  /* Refunds share intent validation and deduplication with fulfillment. Mark purchase history instead of deleting the audit trail. */
  async revoke(event) {
    return this.mutate((data) => {
      if (data.processedEvents[event.eventId]) return { duplicate: true };
      const checkout = this.findCheckout(data, event);
      if (!checkout) {
        // A refund may arrive before the purchase supplies the reference mapping.
        const at = new Date(this.now()).toISOString();
        data.refunds[event.purchaseId] = { at, refundId: event.refundId };
        data.processedEvents[event.eventId] = { refundId: event.refundId, at };
        return { deferred: true, revoked: false };
      }
      checkRefund(checkout, event);

      const at = new Date(this.now()).toISOString();
      const granted = checkout.status === 'fulfilled';
      let revoked = false;
      if (granted) {
        const player = data.players[checkout.accountId];
        /* Revoke only the grant this purchase made; a duplicate purchase's refund leaves the first purchase's item in place. */
        const grant = player?.entitlements?.[checkout.entitlement];
        if (grant && (!grant.purchaseId || grant.purchaseId === checkout.purchaseId)) {
          const replacement = replacementGrant(player.purchases, checkout);
          if (replacement) {
            player.entitlements[checkout.entitlement] = replacement;
          } else {
            delete player.entitlements[checkout.entitlement];
            revoked = true;
          }
        }
        const purchase = player?.purchases?.find((entry) => entry.purchaseId === checkout.purchaseId);
        if (purchase) { purchase.refundedAt = at; purchase.refundId = event.refundId || null; }
      }
      /* Mark pending intents refunded too, preventing a later fulfillment from resurrecting ownership. */
      checkout.status = 'refunded';
      checkout.refundedAt = at;
      data.processedEvents[event.eventId] = { refundId: event.refundId || null, at };
      return { duplicate: false, revoked };
    });
  }

  async recentCheckoutCount(accountId, windowMs) {
    const data = await this.load();
    const cutoff = this.now() - windowMs;
    return Object.values(data.checkouts)
      .filter((record) => record.accountId === accountId && Date.parse(record.createdAt || 0) >= cutoff)
      .length;
  }

  async entitlements(accountId) {
    return (await this.load()).players[accountId]?.entitlements || {};
  }

  /* Transfer codes are stored only as hashes. Plaintext ledger exposure would otherwise disclose account bearer credentials. Codes expire and are single-use. */
  async issueTransferCode({ accountId, hash, expiresAt }) {
    return this.mutate((data) => {
      /* Invalidate previous codes for the account so multiple transferable credentials do not accumulate. */
      for (const [key, record] of Object.entries(data.transfers)) {
        if (record.accountId === accountId) delete data.transfers[key];
      }
      data.transfers[hash] = { accountId, expiresAt, issuedAt: new Date(this.now()).toISOString() };
      return { accountId, expiresAt };
    });
  }

  async claimTransferCode(hash) {
    return this.mutate((data) => {
      const record = data.transfers[hash];
      if (!record) return null;
      delete data.transfers[hash];
      if (Date.parse(record.expiresAt) < this.now()) return null;
      return { accountId: record.accountId };
    });
  }

  /* Save versions increase monotonically. When clients send the version they read, reject stale writes rather than losing progress from another device. */
  async readSave(accountId) {
    return (await this.load()).saves[accountId] || null;
  }

  async writeSave({ accountId, save, baseVersion }) {
    return this.mutate((data) => {
      const current = data.saves[accountId] || null;
      const version = current?.version || 0;
      if (baseVersion !== undefined && baseVersion !== version) {
        return { conflict: true, current };
      }
      const next = { save, version: version + 1, updatedAt: new Date(this.now()).toISOString() };
      data.saves[accountId] = next;
      return { conflict: false, current: next };
    });
  }

  /* JSON readiness checks whether the local ledger can be opened; Firestore additionally verifies the remote connection. */
  async healthy() {
    await this.load();
    return true;
  }

  async purchases(accountId) {
    return (await this.load()).players[accountId]?.purchases || [];
  }
}
