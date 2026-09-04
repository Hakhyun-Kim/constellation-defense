import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY = () => ({ checkouts: {}, players: {}, processedEvents: {} });

/* 30일이 지난 미결제 의도와 오래된 멱등성 기록은 지운다. 원장이 무한히 커지면
 * 파일 저장소가 먼저 무너지기 때문. 멱등성 창은 Neon의 재시도 기간(36시간)보다
 * 훨씬 길게 잡아야 안전하다. */
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* 재시도해도 절대 성공하지 않는 거절. Neon은 비-2xx를 36시간 재시도하므로
 * 이런 경우는 200으로 받아 삼키고 로그만 남겨야 한다. 반대로 일시적 실패
 * (디스크·DB)는 던져서 5xx가 나가야 재시도를 받는다. */
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
      const data = await this.load();
      const result = operation(data);
      this.prune(data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2));
      await rename(temporary, this.path);
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

  /* 지급은 이 한 곳에서만 일어난다 — 실결제 웹훅과 mock 경로가 같은 문을 쓴다. */
  async fulfill(event) {
    return this.mutate((data) => {
      if (data.processedEvents[event.eventId]) return { duplicate: true };
      const pending = data.checkouts[event.externalReferenceId];
      if (!pending) throw new PermanentRejection('unknown checkout reference');
      /* 같은 이벤트의 재전송은 위에서 걸린다. 여기까지 온 것은 "다른 이벤트가
       * 이미 지급된 결제 의도를 또 가리키는" 경우라 두 번 주면 안 된다. */
      if (pending.status === 'fulfilled') throw new PermanentRejection('checkout already fulfilled');
      if (pending.accountId !== event.accountId) throw new PermanentRejection('account does not match checkout');
      if (pending.sku !== event.sku) throw new PermanentRejection('sku does not match checkout');
      if (event.quantity !== 1) throw new PermanentRejection('unexpected quantity');
      /* 결제 통화가 우리가 만든 그대로면 금액도 그대로여야 한다. 플레이어가 결제
       * 페이지에서 국가를 바꾼 경우(initialCurrency ≠ currency)는 Neon이 환산한
       * 값이므로 금액 비교 대상이 아니다 — 대신 기록만 남긴다. */
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

  async purchases(accountId) {
    return (await this.load()).players[accountId]?.purchases || [];
  }
}
