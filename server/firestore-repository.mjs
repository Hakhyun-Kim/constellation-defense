/* Firestore ledger implements the JSON interface using transactions across instances. An in-process promise queue cannot prevent two Cloud Run instances from granting the same webhook concurrently. Separate sandbox and production namespaces as well as validating isSandbox. */
/* The factory dynamically imports this module; JSON operation and browser bundles do not load the Firestore SDK. */
import { FieldPath, FieldValue } from '@google-cloud/firestore';
import { PermanentRejection } from './repository.mjs';

/* Retention exceeds Neon's 36-hour retry window. An enabled Firestore TTL policy deletes expired documents without an application cleanup loop. */
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class FirestoreRepository {
  constructor(db, { namespace = 'sandbox', now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    this.root = db.collection('neon-store').doc(namespace);
  }

  get checkouts() { return this.root.collection('checkouts'); }
  get players() { return this.root.collection('players'); }
  get events() { return this.root.collection('processedEvents'); }
  get limits() { return this.root.collection('rateLimits'); }
  get refunds() { return this.root.collection('refunds'); }

  async recordCheckout(record) {
    const at = this.now();
    const stored = {
      ...record,
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + PENDING_TTL_MS),
    };
    const limitRef = this.limits.doc(record.accountId);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(limitRef);
      const recent = (snapshot.exists ? snapshot.data().checkouts || [] : [])
        .filter((stamp) => stamp >= at - PENDING_TTL_MS);
      tx.set(this.checkouts.doc(record.externalReferenceId), stored);
      tx.set(limitRef, { checkouts: [...recent, at].slice(-64), expiresAt: new Date(at + PENDING_TTL_MS) });
    });
    return stored;
  }

  /* Fulfillment occurs only here, inside a transaction. Firestore requires all reads before writes, so load validation documents first. */
  async fulfill(event) {
    const eventRef = this.events.doc(event.eventId);
    const checkoutRef = this.checkouts.doc(event.externalReferenceId);
    return this.db.runTransaction(async (tx) => {
      const [seen, pendingSnapshot] = await Promise.all([tx.get(eventRef), tx.get(checkoutRef)]);
      if (seen.exists) return { duplicate: true };
      if (!pendingSnapshot.exists) throw new PermanentRejection('unknown checkout reference');
      const pending = pendingSnapshot.data();
      /* Reject refunded intents so a late fulfillment cannot restore revoked ownership. */
      if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);
      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');
      const refund = await tx.get(this.refunds.doc(event.purchaseId));
      if (refund.exists) {
        const at = refund.data().at;
        tx.update(checkoutRef, { status: 'refunded', purchaseId: event.purchaseId,
          refundedAt: at, expiresAt: FieldValue.delete() });
        tx.set(eventRef, { purchaseId: event.purchaseId, at });
        return { ignored: 'purchase was refunded before fulfillment' };
      }
      /* Item prices arrive in the settled currency. Compare only when it matches the checkout currency; after a country switch on the hosted page the converted amount is recorded, not compared. */
      const settled = event.settledCurrency ?? event.currency ?? null;
      if (settled && settled === pending.currency && event.price != null && event.price !== pending.price) {
        throw new PermanentRejection('amount does not match checkout');
      }

      const at = new Date(this.now()).toISOString();
      const playerRef = this.players.doc(event.accountId);
      /* Read before the writes below (transaction rule). A second paid purchase of an already-granted permanent item keeps the original grant. */
      const duplicateGrant = Boolean((await tx.get(playerRef)).data()?.entitlements?.[pending.entitlement]);
      if (!duplicateGrant) {
        tx.set(playerRef, {
          entitlements: { [pending.entitlement]: { grantedAt: at, purchaseId: event.purchaseId } },
        }, { merge: true });
      }
      tx.set(playerRef.collection('purchases').doc(event.purchaseId), {
        purchaseId: event.purchaseId,
        orderNumber: event.orderNumber,
        sku: event.sku,
        price: event.price ?? pending.price,
        currency: settled ?? pending.currency,
        currencySwitched: Boolean(settled && settled !== pending.currency),
        duplicateGrant,
        at,
      });
      tx.set(eventRef, {
        purchaseId: event.purchaseId,
        at,
        expiresAt: new Date(this.now() + EVENT_TTL_MS),
      });
      tx.update(checkoutRef, { status: 'fulfilled', purchaseId: event.purchaseId, expiresAt: FieldValue.delete() });
      return { duplicate: false };
    });
  }

  async pendingCheckout(reference) {
    const snapshot = await this.checkouts.doc(String(reference || '')).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  /* Refunds mirror fulfillment with the same transaction and deduplication ledger. externalReferenceId can be null, so also look up by purchaseId; the single-field equality query needs no composite index. */
  async revoke(event) {
    const eventRef = this.events.doc(event.eventId);
    return this.db.runTransaction(async (tx) => {
      const seen = await tx.get(eventRef);
      if (seen.exists) return { duplicate: true };

      let checkoutSnapshot = null;
      if (event.externalReferenceId) {
        const direct = await tx.get(this.checkouts.doc(event.externalReferenceId));
        if (direct.exists) checkoutSnapshot = direct;
      }
      if (!checkoutSnapshot && event.purchaseId) {
        const found = await tx.get(this.checkouts.where('purchaseId', '==', event.purchaseId).limit(1));
        if (!found.empty) [checkoutSnapshot] = found.docs;
      }
      if (!checkoutSnapshot) {
        const at = new Date(this.now()).toISOString();
        tx.set(this.refunds.doc(event.purchaseId), { at, refundId: event.refundId });
        tx.set(eventRef, { refundId: event.refundId, at });
        return { deferred: true, revoked: false };
      }

      const checkout = checkoutSnapshot.data();
      if (event.accountId && checkout.accountId !== event.accountId) {
        throw new PermanentRejection('account does not match checkout');
      }
      if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');

      const at = new Date(this.now()).toISOString();
      const granted = checkout.status === 'fulfilled';
      let revoked = false;
      if (granted) {
        const playerRef = this.players.doc(checkout.accountId);
        /* Revoke only the grant this purchase made; a duplicate purchase's refund leaves the first purchase's item in place.
         * Entitlement keys contain dots. Use FieldPath so Firestore does not interpret them as nested paths. */
        const grant = (await tx.get(playerRef)).data()?.entitlements?.[checkout.entitlement];
        if (grant && (!grant.purchaseId || grant.purchaseId === checkout.purchaseId)) {
          tx.update(playerRef, new FieldPath('entitlements', checkout.entitlement), FieldValue.delete());
          revoked = true;
        }
        tx.set(playerRef.collection('purchases').doc(checkout.purchaseId), {
          refundedAt: at, refundId: event.refundId || null,
        }, { merge: true });
      }
      /* Mark even pending intents refunded so late fulfillment is rejected. */
      tx.update(checkoutSnapshot.ref, { status: 'refunded', refundedAt: at, expiresAt: FieldValue.delete() });
      tx.set(eventRef, { refundId: event.refundId || null, at, expiresAt: new Date(this.now() + EVENT_TTL_MS) });
      return { duplicate: false, revoked };
    });
  }

  /* Keep recent timestamps in one document per account to avoid an accountId/createdAt composite index and extra query cost. */
  async recentCheckoutCount(accountId, windowMs) {
    const snapshot = await this.limits.doc(accountId).get();
    if (!snapshot.exists) return 0;
    const cutoff = this.now() - windowMs;
    return (snapshot.data().checkouts || []).filter((stamp) => stamp >= cutoff).length;
  }

  async entitlements(accountId) {
    const snapshot = await this.players.doc(accountId).get();
    return snapshot.exists ? snapshot.data().entitlements || {} : {};
  }

  get transfers() { return this.root.collection('transferCodes'); }
  get saves() { return this.root.collection('saves'); }

  /* Account transfer stores only the code hash as the document ID, never the plaintext code. */
  async issueTransferCode({ accountId, hash, expiresAt }) {
    /* Invalidate previously issued codes for the account using a single-field query. Concurrent issuance still needs stronger serialization. */
    const previous = await this.transfers.where('accountId', '==', accountId).get();
    const batch = this.db.batch();
    previous.docs.forEach((doc) => batch.delete(doc.ref));
    batch.set(this.transfers.doc(hash), {
      accountId,
      expiresAt: new Date(expiresAt),
      issuedAt: new Date(this.now()).toISOString(),
    });
    await batch.commit();
    return { accountId, expiresAt };
  }

  async claimTransferCode(hash) {
    const ref = this.transfers.doc(hash);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const record = snapshot.data();
      /* Consume the code once, including expired codes. */
      tx.delete(ref);
      const expires = record.expiresAt?.toDate ? record.expiresAt.toDate().getTime() : Date.parse(record.expiresAt);
      if (expires < this.now()) return null;
      return { accountId: record.accountId };
    });
  }

  /* Account save snapshots. The save is stored as one JSON string: Firestore rejects nested arrays and
   * some key shapes as native fields, and a client-defined document must round-trip whatever it holds.
   * Documents written before this change carry a native `save` field and are read as they are. */
  inflateSave(data) {
    if (!data) return null;
    if (typeof data.payload === 'string') {
      const { payload, ...rest } = data;
      return { ...rest, save: JSON.parse(payload) };
    }
    return data;
  }

  async readSave(accountId) {
    const snapshot = await this.saves.doc(accountId).get();
    return snapshot.exists ? this.inflateSave(snapshot.data()) : null;
  }

  async writeSave({ accountId, save, baseVersion }) {
    const ref = this.saves.doc(accountId);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = snapshot.exists ? this.inflateSave(snapshot.data()) : null;
      const version = current?.version || 0;
      if (baseVersion !== undefined && baseVersion !== version) return { conflict: true, current };
      const updatedAt = new Date(this.now()).toISOString();
      tx.set(ref, { payload: JSON.stringify(save), version: version + 1, updatedAt });
      return { conflict: false, current: { save, version: version + 1, updatedAt } };
    });
  }

  /* Read a document that need not exist to verify database connectivity for readiness. */
  async healthy() {
    await this.root.get();
    return true;
  }

  async purchases(accountId) {
    const snapshot = await this.players.doc(accountId).collection('purchases').get();
    return snapshot.docs.map((doc) => doc.data());
  }
}
