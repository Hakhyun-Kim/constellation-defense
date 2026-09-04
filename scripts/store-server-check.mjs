/* Neon 상점 통합 검증.
 *
 * 실제 HTTP 서버를 임시 포트에 띄우고 클라이언트가 하는 것과 같은 요청을 보낸다.
 * 검증 대상은 "정상 구매"가 아니라 정상이 아닌 경우들이다 — 서명 위조, 재전송,
 * 가격 위조, 환경 불일치, 남의 계정, 그리고 Neon이 36시간 재시도하게 만드는
 * 응답 코드.
 *
 * 같은 검증을 저장소 두 구현에 모두 돌린다. JSON 은 항상, Firestore 는
 * FIRESTORE_EMULATOR_HOST 가 있을 때만 — "인터페이스가 같다"는 주장은 같은
 * 단언을 통과해야 성립하기 때문이다. */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPrice, PRODUCTS } from '../server/catalog.mjs';
import { JsonRepository } from '../server/repository.mjs';
import { createStoreApi } from '../server/store-api.mjs';

const secret = 'test-webhook-secret';
const quiet = { info() {}, warn() {}, error() {} };

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

  /* 모의 리다이렉트에 우리가 만든 참조가 실려 있다 — 실제 클라이언트도 같은
   * 값을 이 경로로 되돌려 받는다. 원장을 직접 들여다보지 않아도 되게 한다. */
  const referenceOf = (redirectUrl) => new URL(redirectUrl).searchParams.get('reference');

  const ownsBanner = async (cookie) => {
    const data = await call('/api/store/entitlements', { headers: { cookie } }).then((r) => r.json());
    return Boolean(data.entitlements['cosmetic.celestial_banner']);
  };

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    // --- 카탈로그: 가격 표시는 파생되고, 국가는 언어가 아니라 신호에서 온다 ---
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

    // 게임 언어를 영어로 바꿔도 청구 국가는 따라오지 않는다.
    const englishCatalog = await call('/api/store/catalog?locale=en', { headers: { cookie } }).then((r) => r.json());
    assert.equal(englishCatalog.country, 'KR', '언어 토글이 청구 국가를 바꾸지 않는다');
    assert.equal(englishCatalog.items[0].currency, 'KRW');
    assert.equal(englishCatalog.items[0].name, 'Celestial Pioneer Banner', '표시 문구만 번역된다');

    // 브라우저 지역 신호는 국가로 인정된다.
    const usCatalog = await call('/api/store/catalog?locale=ko', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
      .then((r) => r.json());
    assert.equal(usCatalog.country, 'US', 'Accept-Language 지역이 기본 국가가 된다');
    assert.equal(usCatalog.items[0].currency, 'USD');

    // 명시적 선택이 모든 추론을 이긴다.
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

    // --- 체크아웃: 클라이언트가 보낸 가격은 무시된다 ---
    const checkoutResponse = await openCheckout(cookie, { price: 1, country: 'US', currency: 'USD' });
    assert.equal(checkoutResponse.status, 201);
    const reference = referenceOf((await checkoutResponse.json()).redirectUrl);
    const pending = await repository.pendingCheckout(reference);
    assert.equal(pending.sku, 'CELESTIAL_BANNER');
    assert.equal(pending.price, PRODUCTS.CELESTIAL_BANNER.prices.KRW, '가격은 서버 카탈로그에서만 온다');
    assert.equal(pending.currency, 'KRW', '본문의 country/currency는 무시된다');
    assert.equal(pending.status, 'pending');

    // --- 재시도해도 소용없는 이벤트는 2xx로 삼킨다 (36시간 재시도 방지) ---
    const unknownReference = await deliver(purchaseEvent(
      { id: 'event-unknown' },
      { accountId: pending.accountId, externalReferenceId: 'no-such-reference' },
    ));
    assert.equal(unknownReference.response.status, 200, '모르는 결제 참조는 재시도를 부르지 않는다');
    assert.equal(unknownReference.payload.ignored, 'unknown checkout reference');

    const otherType = await deliver(purchaseEvent({ id: 'event-refund', type: 'refund.processed' }));
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

    // --- 서명 실패만 비-2xx로 남긴다 ---
    const forged = await deliver(purchaseEvent(), { signature: 'deadbeef' });
    assert.equal(forged.response.status, 403, '서명이 틀리면 거절한다');
    const unsigned = await call('/api/webhooks/neon', { method: 'POST', body: JSON.stringify(purchaseEvent()) });
    assert.equal(unsigned.status, 403, '서명이 없으면 거절한다');

    // --- 정상 지급과 재전송 ---
    const good = purchaseEvent({}, { accountId: pending.accountId, externalReferenceId: reference });
    for (const attempt of [1, 2]) {
      const { response } = await deliver(good);
      assert.equal(response.status, 200, `정상 웹훅과 재전송 모두 200 (${attempt}회차)`);
    }
    assert.equal(await ownsBanner(cookie), true, '치장품이 지급된다');
    assert.equal((await repository.purchases(pending.accountId)).length, 1, '재전송이 이중 지급으로 이어지지 않는다');
    assert.equal((await repository.pendingCheckout(reference)).status, 'fulfilled');

    // 다른 이벤트 id로 같은 결제 의도를 또 가리켜도 두 번 주지 않는다.
    const replayNewId = await deliver(purchaseEvent(
      { id: 'event-2' },
      { id: 'purchase-2', accountId: pending.accountId, externalReferenceId: reference },
    ));
    assert.equal(replayNewId.response.status, 200);
    assert.equal(replayNewId.payload.ignored, 'checkout already fulfilled');
    assert.equal((await repository.purchases(pending.accountId)).length, 1);

    // --- 체크아웃 생성 속도 제한 ---
    const spammer = sessionCookie(await call('/api/store/catalog?locale=ko'));
    let limited = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ((await openCheckout(spammer)).status === 429) limited += 1;
    }
    assert.ok(limited > 0, '체크아웃 생성은 무제한이 아니다');

    /* --- 실제 Neon 호출 경로 ---
     * 모의 모드는 neon-client 를 통째로 건너뛴다. 그래서 여기서는 mock:false 로
     * 두고 fetch 만 가짜로 갈아끼워, 샌드박스에서 처음 눌렀을 때 우리 쪽 문제로
     * 실패하지 않도록 나가는 요청의 모양과 실패 처리를 미리 확인한다. */
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
      // Neon 이 요구하는 필드가 모두 실려 있는지 — 하나라도 빠지면 첫 샌드박스 시도가 거절된다
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

    console.log(`  ✅ ${label}: 카탈로그·국가 해석·가격 계약·서명·재전송·환경·속도 제한·실호출 경로`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- JSON 원장: 자격 증명도 에뮬레이터도 없이 항상 돈다 ---
const temporary = await mkdtemp(join(tmpdir(), 'constellation-store-'));
try {
  await runSuite(new JsonRepository(join(temporary, 'store.json')), 'JSON 원장');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

/* --- Firestore 원장: 에뮬레이터가 있을 때만 ---
 * Cloud Run 은 인스턴스를 여러 개 띄우므로 프로세스 안의 큐로는 exactly-once 를
 * 지킬 수 없다. 그 보장을 트랜잭션으로 옮긴 구현이 같은 단언을 통과하는지 본다.
 *   gcloud emulators firestore start --host-port=127.0.0.1:8080
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run store:check */
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
