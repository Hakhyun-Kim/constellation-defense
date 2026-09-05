import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY = () => ({ checkouts: {}, players: {}, processedEvents: {}, transfers: {}, saves: {}, refunds: {} });

/* Prune unpaid intents and old deduplication records after 30 days to bound file growth. Retention must comfortably exceed Neon's 36-hour retry window. */
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* Permanent rejections are acknowledged with 200 and logged because retries cannot fix them. Disk/database failures propagate as 5xx so Neon retries. */
export class PermanentRejection extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'PermanentRejection';
    this.reason = reason;
  }
}

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
      if (!pending) throw new PermanentRejection('unknown checkout reference');
      /* Event replay was handled above. A new event referencing a processed or refunded intent must also be rejected so late delivery cannot reverse a refund. */
      if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);
      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');
      const refund = data.refunds[event.purchaseId];
      if (refund) {
        pending.status = 'refunded';
        pending.purchaseId = event.purchaseId;
        pending.refundedAt = refund.at;
        data.processedEvents[event.eventId] = { purchaseId: event.purchaseId, at: refund.at };
        return { ignored: 'purchase was refunded before fulfillment' };
      }
      /* Compare prices only when settlement currency matches the original checkout currency. Neon-converted amounts are recorded rather than compared directly. */
      if (event.currency && event.currency === pending.currency && event.price != null && event.price !== pending.price) {
        throw new PermanentRejection('amount does not match checkout');
      }
      const player = data.players[event.accountId] ||= { entitlements: {}, purchases: [] };
      const at = new Date(this.now()).toISOString();
      player.entitlements[pending.entitlement] = { grantedAt: at, purchaseId: event.purchaseId };
      player.purchases.push({
        purchaseId: event.purchaseId,
        orderNumber: event.orderNumber,
        sku: event.sku,
        price: event.price ?? pending.price,
        currency: event.currency ?? pending.currency,
        currencySwitched: Boolean(event.currency && event.currency !== pending.currency),
        at,
      });
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
      if (event.accountId && checkout.accountId !== event.accountId) {
        throw new PermanentRejection('account does not match checkout');
      }
      if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');

      const at = new Date(this.now()).toISOString();
      const granted = checkout.status === 'fulfilled';
      if (granted) {
        const player = data.players[checkout.accountId];
        delete player?.entitlements?.[checkout.entitlement];
        const purchase = player?.purchases?.find((entry) => entry.purchaseId === checkout.purchaseId);
        if (purchase) { purchase.refundedAt = at; purchase.refundId = event.refundId || null; }
      }
      /* Mark pending intents refunded too, preventing a later fulfillment from resurrecting ownership. */
      checkout.status = 'refunded';
      checkout.refundedAt = at;
      data.processedEvents[event.eventId] = { refundId: event.refundId || null, at };
      return { duplicate: false, revoked: granted };
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
