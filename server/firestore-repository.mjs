/* Firestore 원장 — JsonRepository 와 같은 인터페이스, 다른 보장.
 *
 * JsonRepository 의 멱등성은 한 프로세스 안의 프로미스 큐에서 나온다. Cloud Run
 * 처럼 인스턴스가 여러 개면 그 보장이 사라진다 — 같은 웹훅이 두 인스턴스에
 * 동시에 도착하면 둘 다 "아직 처리 안 됨"을 읽고 둘 다 지급한다. 그래서 이
 * 구현의 핵심은 저장 위치가 아니라 fulfill 을 감싸는 트랜잭션이다.
 *
 * 환경(sandbox/production)으로 네임스페이스를 나눈다. 웹훅에서 isSandbox 를
 * 확인하는 것과 같은 이유로, 데이터도 섞이면 안 된다. */
/* 이 모듈은 팩토리에서 동적 import 로만 불린다 — JSON 경로와 브라우저 번들은
 * @google-cloud/firestore 를 아예 건드리지 않는다. */
import { FieldPath, FieldValue } from '@google-cloud/firestore';
import { PermanentRejection } from './repository.mjs';

/* Neon 의 재시도 창(36시간)보다 훨씬 길게 잡는다. TTL 정책을 켜면 Firestore 가
 * expiresAt 을 보고 알아서 지운다 — 직접 도는 정리 루프가 필요 없다. */
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

  /* 지급은 여기 한 곳에서만, 그리고 반드시 트랜잭션 안에서 일어난다.
   * Firestore 는 트랜잭션 안의 모든 읽기가 쓰기보다 먼저 오기를 요구하므로,
   * 검증에 필요한 문서를 앞에서 한꺼번에 읽는다. */
  async fulfill(event) {
    const eventRef = this.events.doc(event.eventId);
    const checkoutRef = this.checkouts.doc(event.externalReferenceId);
    return this.db.runTransaction(async (tx) => {
      const [seen, pendingSnapshot] = await Promise.all([tx.get(eventRef), tx.get(checkoutRef)]);
      if (seen.exists) return { duplicate: true };
      if (!pendingSnapshot.exists) throw new PermanentRejection('unknown checkout reference');
      const pending = pendingSnapshot.data();
      /* refunded 도 막는다 — 환불 웹훅이 지급 웹훅보다 먼저 도착하면
       * 뒤늦은 지급이 회수를 되돌려 버린다. */
      if (pending.status !== 'pending') throw new PermanentRejection(`checkout is already ${pending.status}`);
      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');
      /* 결제 통화가 우리가 만든 그대로면 금액도 그대로여야 한다. 플레이어가 결제
       * 페이지에서 국가를 바꾼 경우는 Neon 이 환산한 값이므로 비교 대상이 아니다. */
      if (event.currency && event.currency === pending.currency && event.price != null && event.price !== pending.price) {
        throw new PermanentRejection('amount does not match checkout');
      }

      const at = new Date(this.now()).toISOString();
      const playerRef = this.players.doc(event.accountId);
      tx.set(playerRef, {
        entitlements: { [pending.entitlement]: { grantedAt: at, purchaseId: event.purchaseId } },
      }, { merge: true });
      tx.set(playerRef.collection('purchases').doc(event.purchaseId), {
        purchaseId: event.purchaseId,
        orderNumber: event.orderNumber,
        sku: event.sku,
        price: event.price ?? pending.price,
        currency: event.currency ?? pending.currency,
        currencySwitched: Boolean(event.currency && event.currency !== pending.currency),
        at,
      });
      tx.set(eventRef, {
        purchaseId: event.purchaseId,
        at,
        expiresAt: new Date(this.now() + EVENT_TTL_MS),
      });
      tx.update(checkoutRef, { status: 'fulfilled', purchaseId: event.purchaseId });
      return { duplicate: false };
    });
  }

  async pendingCheckout(reference) {
    const snapshot = await this.checkouts.doc(String(reference || '')).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  /* 환불은 지급의 거울상이다 — 같은 트랜잭션, 같은 멱등성 원장, 반대 방향.
   *
   * 결제 의도를 되찾는 길이 두 개인 이유: 환불 이벤트의 externalReferenceId 는
   * null 로 올 수 있고(문서 예시가 그렇다), 분쟁 이벤트는 purchaseId 하나만
   * 싣는다. purchaseId 질의는 단일 필드 동등 비교라 복합 색인이 필요 없다. */
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
      if (!checkoutSnapshot) throw new PermanentRejection('unknown checkout reference');

      const checkout = checkoutSnapshot.data();
      if (event.accountId && checkout.accountId !== event.accountId) {
        throw new PermanentRejection('account does not match checkout');
      }
      if (event.sku && checkout.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (checkout.status === 'refunded') throw new PermanentRejection('checkout is already refunded');

      const at = new Date(this.now()).toISOString();
      const granted = checkout.status === 'fulfilled';
      if (granted) {
        const playerRef = this.players.doc(checkout.accountId);
        /* 권리 키에 점이 들어 있다(cosmetic.celestial_banner). 문자열 경로로
         * 쓰면 중첩 필드로 해석되므로 FieldPath 로 감싸야 한다. */
        tx.update(playerRef, new FieldPath('entitlements', checkout.entitlement), FieldValue.delete());
        tx.set(playerRef.collection('purchases').doc(checkout.purchaseId), {
          refundedAt: at, refundId: event.refundId || null,
        }, { merge: true });
      }
      /* 아직 pending 이어도 refunded 로 넘긴다 — 뒤늦은 지급 웹훅을 fulfill 이 거절한다. */
      tx.update(checkoutSnapshot.ref, { status: 'refunded', refundedAt: at });
      tx.set(eventRef, { refundId: event.refundId || null, at, expiresAt: new Date(this.now() + EVENT_TTL_MS) });
      return { duplicate: false, revoked: granted };
    });
  }

  /* checkouts 를 accountId+createdAt 으로 질의하면 복합 색인이 필요하고, 색인
   * 배포가 한 단계 더 늘어난다. 계정당 문서 하나에 최근 시각만 들고 있으면
   * 읽기 한 번으로 끝나고 색인이 필요 없다. */
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

  /* 준비 상태 점검 — 존재하지 않아도 되는 문서를 한 번 읽어 연결을 확인한다. */
  async healthy() {
    await this.root.get();
    return true;
  }

  async purchases(accountId) {
    const snapshot = await this.players.doc(accountId).collection('purchases').get();
    return snapshot.docs.map((doc) => doc.data());
  }
}
