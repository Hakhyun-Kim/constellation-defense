/* Neon integration tests use real HTTP on an ephemeral port. Cover forged signatures, replay, client prices, environment mismatch, other accounts and retry response codes. Run identical assertions against JSON and, when FIRESTORE_EMULATOR_HOST is configured, Firestore. */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutItem, formatPrice, PRODUCTS } from '../server/catalog.mjs';
import { JsonRepository } from '../server/repository.mjs';
import { createStoreApi } from '../server/store-api.mjs';
import './store-regression-check.mjs';

const secret = 'test-webhook-secret';
const quiet = { info() {}, warn() {}, error() {} };
assert.equal(checkoutItem('constructor', { country: 'KR', locale: 'en' }), null);

async function runSuite(repository, label) {
  let origin;
  const handler = createStoreApi({
    repository,
    config: { mock: true, webhookSecret: secret, publicUrl: 'http://127.0.0.1', environment: 'sandbox' },
    log: quiet,
  });
  const server = createServer(async (req, res) => handler(req, res, new URL(req.url, origin)));

  const call = (path, options = {}) => fetch(`${origin}${path}`, options);
  const sessionCookie = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

  function purchaseEvent(overrides = {}, purchaseOverrides = {}) {
    return {
      id: 'event-1', type: 'purchase.completed', version: 2, isSandbox: true,
      ...overrides,
      data: { purchase: {
        id: 'purchase-1', orderNumber: 'TEST-ORDER', status: 'complete',
        currency: 'KRW', initialCurrency: 'KRW',
        items: [{ sku: 'CELESTIAL_BANNER', quantity: 1, price: PRODUCTS.CELESTIAL_BANNER.prices.KRW }],
        ...purchaseOverrides,
      } },
    };
  }

  async function deliver(event, { signature } = {}) {
    const raw = JSON.stringify(event);
    const digest = signature ?? createHmac('sha256', secret).update(raw).digest('hex');
    const response = await call('/api/webhooks/neon', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-neon-digest': digest }, body: raw,
    });
    return { response, payload: await response.json() };
  }

  const openCheckout = (cookie, body = {}) => call('/api/store/checkout', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'CELESTIAL_BANNER', locale: 'ko', ...body }),
  });

  /* The mock redirect carries the checkout reference, as the client sees it, without inspecting the ledger directly. */
  const referenceOf = (redirectUrl) => new URL(redirectUrl).searchParams.get('reference');

  const ownsBanner = async (cookie) => {
    const data = await call('/api/store/entitlements', { headers: { cookie } }).then((r) => r.json());
    return Boolean(data.entitlements['cosmetic.celestial_banner']);
  };

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    // Three independent cosmetics: pending does not grant; refund preserves siblings.
    const multiResponse = await call('/api/store/catalog?locale=en');
    const multiCookie = sessionCookie(multiResponse);
    const multi = await multiResponse.json();
    assert.equal(multi.items.length, 3);
    const mockPost = (path, reference) => call(path, { method: 'POST', headers: { cookie: multiCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reference }) });
    const inventory = () => call('/api/store/entitlements', { headers: { cookie: multiCookie } }).then(r => r.json()).then(data => data.entitlements);
    const refs = [];
    for (const item of multi.items) {
      const response = await openCheckout(multiCookie, { sku: item.sku });
      assert.equal(response.status, 201);
      const ref = referenceOf((await response.json()).redirectUrl); refs.push(ref);
      assert.equal((await inventory())[item.entitlement], undefined);
      assert.equal((await mockPost('/api/store/mock-complete', ref)).status, 200);
    }
    assert.equal(Object.keys(await inventory()).length, 3);
    assert.equal((await mockPost('/api/store/mock-refund', refs[1])).status, 200);
    const remaining = await inventory();
    assert.ok(remaining[multi.items[0].entitlement]);
    assert.equal(remaining[multi.items[1].entitlement], undefined);
    assert.ok(remaining[multi.items[2].entitlement]);
    const rebuy = await openCheckout(multiCookie, { sku: multi.items[1].sku });
    assert.equal(rebuy.status, 201);
    await mockPost('/api/store/mock-complete', referenceOf((await rebuy.json()).redirectUrl));
    assert.equal(Object.keys(await inventory()).length, 3);

    // Catalog: derive price display; infer country from billing signals, not game language.
    const catalogResponse = await call('/api/store/catalog?locale=ko');
    assert.equal(catalogResponse.status, 200);
    const cookie = sessionCookie(catalogResponse);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.items[0].sku, 'CELESTIAL_BANNER');
    assert.equal(catalog.country, 'KR', '기본 시장은 KR');
    assert.equal(catalog.items[0].currency, 'KRW');
    assert.equal(
      catalog.items[0].displayPrice,
      formatPrice(PRODUCTS.CELESTIAL_BANNER.prices.KRW, 'KRW'),
      '표시 가격은 정수에서 파생된다 — 손으로 적은 문자열이 아니다',
    );
    assert.equal(catalog.items[0].price, 490000, '₩4,900은 Neon의 100배 정수로 490000');

    // Switching game language to English must not change billing country.
    const englishCatalog = await call('/api/store/catalog?locale=en', { headers: { cookie } }).then((r) => r.json());
    assert.equal(englishCatalog.country, 'KR', '언어 토글이 청구 국가를 바꾸지 않는다');
    assert.equal(englishCatalog.items[0].currency, 'KRW');
    assert.equal(englishCatalog.items[0].name, 'Celestial Pioneer Banner', '표시 문구만 번역된다');
    const englishCheckout = await openCheckout(cookie, { locale: 'en' });
    assert.equal(new URL((await englishCheckout.json()).redirectUrl).searchParams.get('lang'), 'en');

    // The browser's region is a country signal.
    const usCatalog = await call('/api/store/catalog?locale=ko', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
      .then((r) => r.json());
    assert.equal(usCatalog.country, 'US', 'Accept-Language 지역이 기본 국가가 된다');
    assert.equal(usCatalog.items[0].currency, 'USD');

    // Explicit selection takes precedence over inference.
    const marketResponse = await call('/api/store/market', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ country: 'US' }),
    });
    assert.equal(marketResponse.status, 200);
    const chosen = [cookie, sessionCookie(marketResponse)].join('; ');
    const chosenCatalog = await call('/api/store/catalog?locale=ko', { headers: { cookie: chosen } }).then((r) => r.json());
    assert.equal(chosenCatalog.items[0].currency, 'USD', '명시적 국가 선택이 유지된다');
    const badMarket = await call('/api/store/market', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ country: 'ZZ' }),
    });
    assert.equal(badMarket.status, 400, '지원하지 않는 국가는 거절된다');

    // Checkout ignores client-supplied prices.
    const checkoutResponse = await openCheckout(cookie, { price: 1, country: 'US', currency: 'USD' });
    assert.equal(checkoutResponse.status, 201);
    const reference = referenceOf((await checkoutResponse.json()).redirectUrl);
    const pending = await repository.pendingCheckout(reference);
    assert.equal(pending.sku, 'CELESTIAL_BANNER');
    assert.equal(pending.price, PRODUCTS.CELESTIAL_BANNER.prices.KRW, '가격은 서버 카탈로그에서만 온다');
    assert.equal(pending.currency, 'KRW', '본문의 country/currency는 무시된다');
    assert.equal(pending.status, 'pending');

    // Acknowledge permanently invalid events with 2xx to avoid futile retries.
    const unknownReference = await deliver(purchaseEvent(
      { id: 'event-unknown' },
      { accountId: pending.accountId, externalReferenceId: 'no-such-reference' },
    ));
    assert.equal(unknownReference.response.status, 200, '모르는 결제 참조는 재시도를 부르지 않는다');
    assert.equal(unknownReference.payload.ignored, 'unknown checkout reference');

    /* Unrelated subscription, invoice and funnel events receive 2xx even if accidentally enabled in Console. */
    const otherType = await deliver(purchaseEvent({ id: 'event-subscription', type: 'subscription.activated' }));
    assert.equal(otherType.response.status, 200, '처리하지 않는 이벤트도 2xx로 받는다');
    assert.match(otherType.payload.ignored, /unhandled type/);

    const wrongEnvironment = await deliver(purchaseEvent(
      { id: 'event-prod', isSandbox: false },
      { accountId: pending.accountId, externalReferenceId: reference },
    ));
    assert.equal(wrongEnvironment.response.status, 200);
    assert.match(wrongEnvironment.payload.ignored, /environment mismatch/, '운영 이벤트가 샌드박스 원장에 지급되지 않는다');
    assert.equal(await ownsBanner(cookie), false);

    const wrongAmount = await deliver(purchaseEvent(
      { id: 'event-cheap' },
      {
        accountId: pending.accountId, externalReferenceId: reference,
        items: [{ sku: 'CELESTIAL_BANNER', quantity: 1, price: 100 }],
      },
    ));
    assert.equal(wrongAmount.response.status, 200);
    assert.equal(wrongAmount.payload.ignored, 'amount does not match checkout', '금액이 다르면 지급하지 않는다');
    assert.equal(await ownsBanner(cookie), false);

    const wrongAccount = await deliver(purchaseEvent(
      { id: 'event-stranger' },
      { accountId: '11111111-1111-4111-8111-111111111111', externalReferenceId: reference },
    ));
    assert.equal(wrongAccount.response.status, 200);
    assert.equal(wrongAccount.payload.ignored, 'account does not match checkout');
    assert.equal(await ownsBanner(cookie), false);

    const malformed = await call('/api/webhooks/neon', {
      method: 'POST',
      headers: { 'x-neon-digest': createHmac('sha256', secret).update('{oops').digest('hex') },
      body: '{oops',
    });
    assert.equal(malformed.status, 200, '서명은 맞지만 깨진 본문도 재시도를 부르지 않는다');

    // Reject invalid signatures with a non-2xx response.
    const forged = await deliver(purchaseEvent(), { signature: 'deadbeef' });
    assert.equal(forged.response.status, 403, '서명이 틀리면 거절한다');
    const unsigned = await call('/api/webhooks/neon', { method: 'POST', body: JSON.stringify(purchaseEvent()) });
    assert.equal(unsigned.status, 403, '서명이 없으면 거절한다');

    // Successful fulfillment and replay.
    const good = purchaseEvent({}, { accountId: pending.accountId, externalReferenceId: reference });
    for (const attempt of [1, 2]) {
      const { response } = await deliver(good);
      assert.equal(response.status, 200, `정상 웹훅과 재전송 모두 200 (${attempt}회차)`);
    }
    assert.equal(await ownsBanner(cookie), true, '치장품이 지급된다');
    assert.equal((await repository.purchases(pending.accountId)).length, 1, '재전송이 이중 지급으로 이어지지 않는다');
    assert.equal((await repository.pendingCheckout(reference)).status, 'fulfilled');

    // A different event ID referencing the same checkout must not grant twice.
    const replayNewId = await deliver(purchaseEvent(
      { id: 'event-2' },
      { id: 'purchase-2', accountId: pending.accountId, externalReferenceId: reference },
    ));
    assert.equal(replayNewId.response.status, 200);
    assert.equal(replayNewId.payload.ignored, 'checkout is already fulfilled');
    assert.equal((await repository.purchases(pending.accountId)).length, 1);

    /* Refund revocation: the documented event can have null externalReferenceId, so exercise lookup by purchaseId first. */
    function refundEvent(overrides = {}, refundOverrides = {}) {
      return {
        id: 'refund-1', type: 'refund.processed', version: 2, isSandbox: true,
        ...overrides,
        data: { refund: {
          id: 'rf_1', purchaseId: 'purchase-x', accountId: null, externalReferenceId: null,
          currency: 'KRW', totalAmount: PRODUCTS.CELESTIAL_BANNER.prices.KRW,
          items: [{ sku: 'CELESTIAL_BANNER', quantity: 1, price: PRODUCTS.CELESTIAL_BANNER.prices.KRW }],
          ...refundOverrides,
        } },
      };
    }

    async function boughtOnce(tag) {
      const buyer = sessionCookie(await call('/api/store/catalog?locale=ko'));
      const opened = await openCheckout(buyer);
      const buyerReference = referenceOf((await opened.json()).redirectUrl);
      const record = await repository.pendingCheckout(buyerReference);
      await deliver(purchaseEvent(
        { id: `buy-${tag}` },
        { id: `purchase-${tag}`, accountId: record.accountId, externalReferenceId: buyerReference },
      ));
      assert.equal(await ownsBanner(buyer), true, `${tag}: 구매 후 보유`);
      return { cookie: buyer, reference: buyerReference, accountId: record.accountId, purchaseId: `purchase-${tag}` };
    }

    const refunded = await boughtOnce('a');
    const revoke = await deliver(refundEvent({ id: 'refund-a' }, { id: 'rf_a', purchaseId: refunded.purchaseId }));
    assert.equal(revoke.response.status, 200);
    assert.equal(revoke.payload.revoked, true, 'externalReferenceId 가 null 이어도 purchaseId 로 찾아낸다');
    assert.equal(await ownsBanner(refunded.cookie), false, '환불하면 치장품이 회수된다');
    assert.equal((await repository.pendingCheckout(refunded.reference)).status, 'refunded');
    if (repository.db) {
      assert.equal((await repository.checkouts.doc(refunded.reference).get()).data().expiresAt, undefined,
        'refunded checkouts must survive pending-checkout TTL cleanup');
    }

    // Mark purchase history as refunded instead of deleting the audit trail.
    const history = await repository.purchases(refunded.accountId);
    assert.equal(history.length, 1, '환불해도 구매 기록은 사라지지 않는다');
    assert.ok(history[0].refundedAt, '구매 기록에 환불 시각이 남는다');

    const refundReplay = await deliver(refundEvent({ id: 'refund-a' }, { id: 'rf_a', purchaseId: refunded.purchaseId }));
    assert.equal(refundReplay.response.status, 200);
    assert.equal(refundReplay.payload.duplicate, true, '환불 재전송은 무해하다');

    const secondRefund = await deliver(refundEvent({ id: 'refund-a2' }, { id: 'rf_a2', purchaseId: refunded.purchaseId }));
    assert.equal(secondRefund.payload.ignored, 'checkout is already refunded', '두 번 회수하지 않는다');

    /* A late fulfillment must not resurrect a refunded checkout; fulfill rejects non-pending intents. */
    const lateGrant = await deliver(purchaseEvent(
      { id: 'late-grant' },
      { id: 'purchase-late', accountId: refunded.accountId, externalReferenceId: refunded.reference },
    ));
    assert.equal(lateGrant.payload.ignored, 'checkout is already refunded', '환불된 결제는 뒤늦게도 지급되지 않는다');
    assert.equal(await ownsBanner(refunded.cookie), false);

    // Also support refunds carrying an external reference.
    const byReference = await boughtOnce('b');
    const revokeByReference = await deliver(refundEvent(
      { id: 'refund-b' },
      { id: 'rf_b', purchaseId: byReference.purchaseId, externalReferenceId: byReference.reference },
    ));
    assert.equal(revokeByReference.payload.revoked, true, 'externalReferenceId 가 있으면 그것으로 찾는다');
    assert.equal(await ownsBanner(byReference.cookie), false);

    const unknownRefund = await deliver(refundEvent({ id: 'refund-nowhere' }, { id: 'rf_x', purchaseId: 'purchase-nowhere' }));
    assert.equal(unknownRefund.response.status, 200, '모르는 환불도 재시도를 부르지 않는다');
    assert.equal(unknownRefund.payload.deferred, true, 'unmapped refunds are retained, not discarded');
    const earlyCookie = sessionCookie(await call('/api/store/catalog'));
    const earlyCheckout = await openCheckout(earlyCookie);
    const earlyRef = referenceOf((await earlyCheckout.json()).redirectUrl);
    const earlyRecord = await repository.pendingCheckout(earlyRef);
    const earlyGrant = await deliver(purchaseEvent({ id: 'purchase-after-early-refund' }, {
      id: 'purchase-nowhere', accountId: earlyRecord.accountId, externalReferenceId: earlyRef,
    }));
    assert.equal(earlyGrant.payload.ignored, 'purchase was refunded before fulfillment');
    assert.equal(await ownsBanner(earlyCookie), false);
    assert.equal((await repository.pendingCheckout(earlyRef)).status, 'refunded');

    const strangerRefund = await boughtOnce('c');
    const wrongOwner = await deliver(refundEvent(
      { id: 'refund-c' },
      { id: 'rf_c', purchaseId: strangerRefund.purchaseId, accountId: '33333333-3333-4333-8333-333333333333' },
    ));
    assert.equal(wrongOwner.payload.ignored, 'account does not match checkout', '남의 계정으로 회수할 수 없다');
    assert.equal(await ownsBanner(strangerRefund.cookie), true, '거절된 환불은 아무것도 건드리지 않는다');

    /* Reject purchases of already-owned permanent items on the server; disabled UI buttons are outside the trust boundary. */
    const repurchase = await openCheckout(strangerRefund.cookie);
    assert.equal(repurchase.status, 409, '이미 가진 영구 아이템은 다시 팔지 않는다');
    assert.equal((await repurchase.json()).error, 'already_owned');

    /* Refunded entitlements may be bought again: current ownership, not historical purchases, determines eligibility. */
    const rebuyAfterRefund = await openCheckout(refunded.cookie);
    assert.equal(rebuyAfterRefund.status, 201, '환불받은 뒤에는 다시 살 수 있다');

    /* Mock refunds use the same revoke method as real webhooks to exercise the purchase lifecycle. */
    const tourBuyer = await boughtOnce('tour');
    const mockRefund = await call('/api/store/mock-refund', {
      method: 'POST', headers: { cookie: tourBuyer.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: tourBuyer.reference }),
    });
    assert.equal(mockRefund.status, 200);
    assert.equal((await mockRefund.json()).revoked, true, '모의 환불도 실제 회수 경로를 탄다');
    assert.equal(await ownsBanner(tourBuyer.cookie), false);
    const tourHistory = await repository.purchases(tourBuyer.accountId);
    assert.ok(tourHistory[0].refundedAt, '모의 환불도 감사 기록을 남긴다');

    /* Distinguish replay deduplication from intent-state validation when a new event references a refunded purchase. */
    const mockBuyer = sessionCookie(await call('/api/store/catalog?locale=ko'));
    const mockOpened = await openCheckout(mockBuyer);
    const mockReference = referenceOf((await mockOpened.json()).redirectUrl);
    const mockComplete = (body) => call('/api/store/mock-complete', {
      method: 'POST', headers: { cookie: mockBuyer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: mockReference, ...body }),
    });

    assert.equal((await mockComplete().then((r) => r.json())).duplicate, false, '첫 모의 지급');
    assert.equal(await ownsBanner(mockBuyer), true);
    assert.equal((await mockComplete().then((r) => r.json())).duplicate, true,
      '같은 이벤트 재전송은 멱등성이 잡는다');

    await call('/api/store/mock-refund', {
      method: 'POST', headers: { cookie: mockBuyer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: mockReference }),
    });
    assert.equal(await ownsBanner(mockBuyer), false, '모의 환불로 회수된다');
    assert.equal((await mockComplete({ distinct: true }).then((r) => r.json())).ignored,
      'checkout is already refunded', '환불된 결제를 가리키는 다른 이벤트는 상태가 잡는다');
    assert.equal(await ownsBanner(mockBuyer), false, '뒤늦은 지급이 회수를 되돌리지 않는다');

    /* Mock refunds cannot modify another player's checkout. */
    const stranger = sessionCookie(await call('/api/store/catalog?locale=ko'));
    const notYours = await call('/api/store/mock-refund', {
      method: 'POST', headers: { cookie: stranger, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: strangerRefund.reference }),
    });
    assert.equal(notYours.status, 404, '자기 결제만 모의 환불할 수 있다');

    /* Bearer-only identity supports native clients and separately hosted browser clients without relying on SameSite cookies. */
    assert.ok(catalog.playerId, '카탈로그가 자기 신원을 알려준다 — 토큰 클라이언트가 저장할 수 있도록');
    const byToken = await call('/api/store/entitlements', {
      headers: { authorization: `Bearer ${pending.accountId}` },
    }).then((r) => r.json());
    assert.ok(byToken.entitlements['cosmetic.celestial_banner'], '토큰만으로 소유가 확인된다');
    const strangerToken = await call('/api/store/entitlements', {
      headers: { authorization: 'Bearer 22222222-2222-4222-8222-222222222222' },
    }).then((r) => r.json());
    assert.deepEqual(strangerToken.entitlements, {}, '남의 토큰으로는 아무것도 안 보인다');
    const garbageToken = await call('/api/store/catalog?locale=ko', { headers: { authorization: 'Bearer not-a-uuid' } });
    assert.equal(garbageToken.status, 200, '형식이 틀린 토큰은 새 신원으로 취급한다');
    assert.notEqual((await garbageToken.json()).playerId, 'not-a-uuid');

    // CORS accepts only allowlisted origins.
    const corsHandler = createStoreApi({
      repository,
      config: {
        mock: true, webhookSecret: secret, publicUrl: 'https://api.example.test', environment: 'sandbox',
        allowedOrigins: ['https://hakhyun-kim.github.io'],
      },
      log: quiet,
    });
    const corsServer = createServer(async (req, res) => corsHandler(req, res, new URL(req.url, 'https://api.example.test')));
    try {
      await new Promise((resolve) => corsServer.listen(0, '127.0.0.1', resolve));
      const corsAt = `http://127.0.0.1:${corsServer.address().port}`;
      const preflight = await fetch(`${corsAt}/api/store/checkout`, {
        method: 'OPTIONS',
        headers: { origin: 'https://hakhyun-kim.github.io', 'access-control-request-method': 'POST' },
      });
      assert.equal(preflight.status, 204, '허용된 오리진의 프리플라이트는 통과한다');
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://hakhyun-kim.github.io');
      assert.match(preflight.headers.get('access-control-allow-headers') || '', /Authorization/i, '토큰 헤더가 허용된다');
      assert.equal(preflight.headers.get('access-control-allow-credentials'), null,
        '교차 오리진은 토큰으로 다닌다 — 쿠키를 끌고 가면 서드파티 차단에 걸린다');
      const denied = await fetch(`${corsAt}/api/store/checkout`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      assert.equal(denied.status, 403, '허용 목록에 없는 오리진은 거절된다');
      const sameOrigin = await fetch(`${corsAt}/api/store/catalog?locale=ko`);
      assert.equal(sameOrigin.status, 200, 'Origin 헤더가 없는 요청은 영향을 받지 않는다');
    } finally { await new Promise((resolve) => corsServer.close(resolve)); }

    // Checkout creation rate limit.
    const spammer = sessionCookie(await call('/api/store/catalog?locale=ko'));
    let limited = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ((await openCheckout(spammer)).status === 429) limited += 1;
    }
    assert.ok(limited > 0, '체크아웃 생성은 무제한이 아니다');

    /* Account transfer moves browser-held identity to another device so purchases follow the account. */
    const owner = await boughtOnce('account');
    assert.equal(await ownsBanner(owner.cookie), true);

    const issued = await call('/api/account/transfer-code', {
      method: 'POST', headers: { cookie: owner.cookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(issued.status, 201);
    const { code, expiresAt } = await issued.json();
    assert.match(code, /^CD-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/, '사람이 옮겨 적을 수 있는 형태');
    assert.doesNotMatch(code, /[O0I1L]/, '헷갈리는 글자는 쓰지 않는다');
    assert.ok(Date.parse(expiresAt) > Date.now(), '기한이 있다');

    /* A new device without cookies claims the original account using the code. */
    const freshDevice = sessionCookie(await call('/api/store/catalog?locale=ko'));
    assert.equal(await ownsBanner(freshDevice), false, '새 기기는 아직 아무것도 없다');
    const claimed = await call('/api/account/claim', {
      method: 'POST', headers: { cookie: freshDevice, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    assert.equal(claimed.status, 200);
    const adopted = sessionCookie(claimed);
    assert.equal((await claimed.json()).accountId, owner.accountId, '기기가 기존 계정을 입는다');
    assert.equal(await ownsBanner(adopted), true, '구매가 기기가 아니라 계정을 따라온다');

    /* Transfer codes are single-use bearer credentials; replay must not repeatedly transfer an account. */
    const reused = await call('/api/account/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    assert.equal(reused.status, 404, '같은 코드를 두 번 쓸 수 없다');
    const nonsense = await call('/api/account/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'CD-ZZZZ-ZZZZ-ZZZZ' }),
    });
    assert.equal(nonsense.status, 404);
    assert.equal((await nonsense.json()).error, 'invalid_code', '없음·만료·사용됨을 구분해 주지 않는다');

    // Account save snapshots.
    const emptySave = await call('/api/save', { headers: { cookie: owner.cookie } }).then((r) => r.json());
    assert.deepEqual(emptySave, { save: null, version: 0 }, '저장본이 없으면 0번');

    const putSave = (cookie, payload) => call('/api/save', {
      method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });

    const first = await putSave(owner.cookie, { save: { shards: 12 }, baseVersion: 0 });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).version, 1);

    /* Two devices sharing an account must detect stale versions instead of silently overwriting progress. */
    const stale = await putSave(adopted, { save: { shards: 3 }, baseVersion: 0 });
    assert.equal(stale.status, 409, '오래된 버전은 덮어쓰지 못한다');
    const conflict = await stale.json();
    assert.equal(conflict.version, 1);
    assert.deepEqual(conflict.save, { shards: 12 }, '충돌 응답이 서버의 최신본을 함께 준다');

    const merged = await putSave(adopted, { save: { shards: 20 }, baseVersion: 1 });
    assert.equal(merged.status, 200);
    assert.equal((await merged.json()).version, 2, '최신 버전 위에는 쓸 수 있다');
    assert.deepEqual((await call('/api/save', { headers: { cookie: owner.cookie } }).then((r) => r.json())).save,
      { shards: 20 }, '두 기기가 같은 저장본을 본다');

    /* Exercise the non-mock Neon adapter with injected fetch to verify outgoing payloads and failures before a sandbox attempt. */
    let sent = null;
    const stubNeon = (status, payload) => async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    };

    async function liveServer(fetchImpl) {
      const liveHandler = createStoreApi({
        repository,
        config: {
          mock: false, apiKey: 'test-secret-key', apiUrl: 'https://api.example.test',
          webhookSecret: secret, publicUrl: 'https://tunnel.example.test', environment: 'sandbox',
        },
        fetchImpl, log: quiet,
      });
      const live = createServer(async (req, res) => liveHandler(req, res, new URL(req.url, 'https://tunnel.example.test')));
      await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
      const at = `http://127.0.0.1:${live.address().port}`;
      return {
        at,
        checkout: (buyerCookie) => fetch(`${at}/api/store/checkout`, {
          method: 'POST', headers: { cookie: buyerCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: 'CELESTIAL_BANNER', locale: 'ko' }),
        }),
        close: () => new Promise((resolve) => live.close(resolve)),
      };
    }

    const ok = await liveServer(stubNeon(201, { checkoutId: 'chk_1', redirectUrl: 'https://pay.example.test/chk_1' }));
    try {
      const buyer = sessionCookie(await fetch(`${ok.at}/api/store/catalog?locale=ko`));
      const created = await ok.checkout(buyer);
      assert.equal(created.status, 201);
      assert.equal((await created.json()).redirectUrl, 'https://pay.example.test/chk_1');

      assert.equal(sent.url, 'https://api.example.test/checkout');
      assert.equal(sent.options.headers['X-API-KEY'], 'test-secret-key', 'API 키는 헤더로만 나간다');
      // Assert the required Neon request fields.
      for (const field of ['items', 'externalReferenceId', 'accountId', 'languageLocale', 'playerCountry', 'currency', 'storeUrl', 'successUrl', 'cancelUrl']) {
        assert.ok(sent.body[field] !== undefined, `checkout 요청에 ${field} 가 있다`);
      }
      assert.deepEqual(Object.keys(sent.body.items[0]).sort(), ['name', 'price', 'quantity', 'sku', 'subtitle'],
        '문서에서 확인한 항목 필드만 보낸다');
      assert.equal(sent.body.items[0].price, PRODUCTS.CELESTIAL_BANNER.prices.KRW);
      assert.equal(sent.body.currency, 'KRW');
      assert.equal(sent.body.playerCountry, 'KR');
      assert.equal(sent.body.languageLocale, 'ko-KR');
      assert.ok(sent.body.successUrl.startsWith('https://tunnel.example.test/'), 'successUrl 은 공개 주소를 쓴다');
    } finally { await ok.close(); }

    const rejects = await liveServer(stubNeon(400, { message: 'invalid sku' }));
    try {
      const buyer = sessionCookie(await fetch(`${rejects.at}/api/store/catalog?locale=ko`));
      const failed = await rejects.checkout(buyer);
      assert.equal(failed.status, 502, 'Neon 이 거절하면 502 로 알린다 — 우리 버그와 구분된다');
      assert.doesNotMatch(await failed.text(), /test-secret-key/, '오류 응답에 키가 새지 않는다');
    } finally { await rejects.close(); }

    const incomplete = await liveServer(stubNeon(201, { checkoutId: 'chk_2' }));
    try {
      const buyer = sessionCookie(await fetch(`${incomplete.at}/api/store/catalog?locale=ko`));
      assert.equal((await incomplete.checkout(buyer)).status, 500, 'redirectUrl 없는 응답은 성공으로 치지 않는다');
    } finally { await incomplete.close(); }

    /* Shared-link returns: an allowlisted Origin (plus a validated path) wins
     * over PUBLIC_URL, and every return URL carries api=<this service>. */
    {
      const pagesHandler = createStoreApi({
        repository,
        config: { mock: true, webhookSecret: secret, publicUrl: 'https://tunnel.example.test', environment: 'sandbox', allowedOrigins: ['https://pages.example.test'] },
        log: quiet,
      });
      const pages = createServer(async (req, res) => pagesHandler(req, res, new URL(req.url, 'https://x.local')));
      await new Promise((resolve) => pages.listen(0, '127.0.0.1', resolve));
      const at = `http://127.0.0.1:${pages.address().port}`;
      const linkCheckout = (headers, extra = {}) => fetch(`${at}/api/store/checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ sku: 'CELESTIAL_BANNER', locale: 'en', ...extra }),
      }).then((r) => r.json()).then((data) => new URL(data.redirectUrl));
      try {
        const cookie = sessionCookie(await fetch(`${at}/api/store/catalog?locale=en`));
        const fromPages = await linkCheckout({ cookie, origin: 'https://pages.example.test' }, { returnPath: '/constellation-defense/' });
        assert.equal(fromPages.origin, 'https://pages.example.test', '허용된 Origin 이 복귀 기준이 된다');
        assert.equal(fromPages.pathname, '/constellation-defense/', '검증된 returnPath 가 붙는다');
        assert.ok(fromPages.searchParams.get('api').startsWith('http://127.0.0.1'), '복귀 URL 이 api=<이 서비스> 를 싣는다');
        const forged = await linkCheckout({ cookie, origin: 'https://evil.example.test' }, { returnPath: '/x/' });
        assert.equal(forged.origin, 'https://tunnel.example.test', '허용 목록 밖 Origin 은 PUBLIC_URL 로 돌아간다');
        const traversal = await linkCheckout({ cookie, origin: 'https://pages.example.test' }, { returnPath: '/../evil' });
        assert.equal(traversal.pathname, '/', '경로 검증 실패 시 returnPath 는 무시된다');
      } finally { await new Promise((resolve) => pages.close(resolve)); }
    }

    /* Hosted self-refund: account-scoped, asks Neon item-level, never revokes
     * by itself — the webhook does. Mock mode does not expose the route. */
    {
      const rBuyer = sessionCookie(await call('/api/store/catalog?locale=ko'));
      const rRef = referenceOf((await (await openCheckout(rBuyer)).json()).redirectUrl);
      await call('/api/store/mock-complete', {
        method: 'POST', headers: { cookie: rBuyer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: rRef }),
      });
      assert.equal((await call('/api/store/refund', {
        method: 'POST', headers: { cookie: rBuyer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'CELESTIAL_BANNER' }),
      })).status, 404, 'mock 모드에는 실환불 라우트가 없다');

      let sentRefund = null;
      const refundStub = (refundable = 1) => async (url, options = {}) => {
        if (String(url).endsWith('/refund')) {
          sentRefund = { url: String(url), body: JSON.parse(options.body) };
          return new Response(JSON.stringify({ refundId: 'rf_1' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ status: 'complete', items: [{ id: 'itm_9', sku: 'CELESTIAL_BANNER', refundableQuantity: refundable }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      const hosted = await liveServer(refundStub());
      const refundCall = (cookie) => fetch(`${hosted.at}/api/store/refund`, {
        method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'CELESTIAL_BANNER' }),
      });
      try {
        const accepted = await refundCall(rBuyer);
        assert.equal(accepted.status, 202, '환불 요청은 202 — 회수는 웹훅 몫');
        assert.equal((await accepted.json()).requested, true);
        assert.ok(sentRefund.url.includes(`/purchases/mock-purchase-${rRef}/refund`), '원장의 purchaseId 로 Neon 에 요청한다');
        assert.deepEqual(sentRefund.body, { items: [{ itemId: 'itm_9', quantity: 1 }] }, 'item 단위 본문 — 빈 본문은 샌드박스 500');
        const stranger = sessionCookie(await fetch(`${hosted.at}/api/store/catalog?locale=ko`));
        assert.equal((await refundCall(stranger)).status, 404, '남의 구매는 환불할 수 없다');
      } finally { await hosted.close(); }
      const spent = await liveServer(refundStub(0));
      try {
        assert.equal((await (await fetch(`${spent.at}/api/store/refund`, {
          method: 'POST', headers: { cookie: rBuyer, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: 'CELESTIAL_BANNER' }),
        })).status), 409, 'refundableQuantity 0 이면 409');
      } finally { await spent.close(); }
    }

    console.log(`  ✅ ${label}: 카탈로그·국가 해석·가격 계약·서명·재전송·환경·속도 제한·환불 회수·계정 인계·저장본·실호출·복귀주소·실환불 경로`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// JSON ledger always runs without credentials or an emulator.
const temporary = await mkdtemp(join(tmpdir(), 'constellation-store-'));
try {
  await runSuite(new JsonRepository(join(temporary, 'store.json')), 'JSON 원장');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

/* Firestore tests run only with the emulator. Multiple Cloud Run instances require database transactions, not an in-process queue. Run gcloud emulators firestore start --host-port=127.0.0.1:8080, then set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and run npm run store:check. */
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const { Firestore } = await import('@google-cloud/firestore');
  const { FirestoreRepository } = await import('../server/firestore-repository.mjs');
  const db = new Firestore({ projectId: 'store-check' });
  await runSuite(new FirestoreRepository(db, { namespace: `check-${randomUUID()}` }), 'Firestore 원장');
  await db.terminate();
} else {
  console.log('  ⏭  Firestore 원장: 건너뜀 (FIRESTORE_EMULATOR_HOST 없음)');
}

console.log('store server check: 통과');
