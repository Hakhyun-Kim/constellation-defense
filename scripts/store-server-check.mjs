/* Neon 상점 통합 검증.
 *
 * 실제 HTTP 서버를 임시 포트에 띄우고 클라이언트가 하는 것과 같은 요청을 보낸다.
 * 검증 대상은 "정상 구매"가 아니라 정상이 아닌 경우들이다 — 서명 위조, 재전송,
 * 가격 위조, 환경 불일치, 남의 계정, 그리고 Neon이 36시간 재시도하게 만드는
 * 응답 코드. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPrice, PRODUCTS } from '../server/catalog.mjs';
import { JsonRepository } from '../server/repository.mjs';
import { createStoreApi } from '../server/store-api.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'constellation-store-'));
const repository = new JsonRepository(join(temporary, 'store.json'));
const secret = 'test-webhook-secret';
const quiet = { info() {}, warn() {}, error() {} };
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

async function openCheckout(cookie, body = {}) {
  const response = await call('/api/store/checkout', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'CELESTIAL_BANNER', locale: 'ko', ...body }),
  });
  return response;
}

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
  const ledger = await repository.load();
  const pending = Object.values(ledger.checkouts)[0];
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
    { accountId: pending.accountId, externalReferenceId: pending.externalReferenceId },
  ));
  assert.equal(wrongEnvironment.response.status, 200);
  assert.match(wrongEnvironment.payload.ignored, /environment mismatch/, '운영 이벤트가 샌드박스 원장에 지급되지 않는다');
  assert.equal(await ownsBanner(cookie), false);

  const wrongAmount = await deliver(purchaseEvent(
    { id: 'event-cheap' },
    {
      accountId: pending.accountId, externalReferenceId: pending.externalReferenceId,
      items: [{ sku: 'CELESTIAL_BANNER', quantity: 1, price: 100 }],
    },
  ));
  assert.equal(wrongAmount.response.status, 200);
  assert.equal(wrongAmount.payload.ignored, 'amount does not match checkout', '금액이 다르면 지급하지 않는다');
  assert.equal(await ownsBanner(cookie), false);

  const wrongAccount = await deliver(purchaseEvent(
    { id: 'event-stranger' },
    { accountId: '11111111-1111-4111-8111-111111111111', externalReferenceId: pending.externalReferenceId },
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
  const good = purchaseEvent({}, { accountId: pending.accountId, externalReferenceId: pending.externalReferenceId });
  for (const attempt of [1, 2]) {
    const { response } = await deliver(good);
    assert.equal(response.status, 200, `정상 웹훅과 재전송 모두 200 (${attempt}회차)`);
  }
  assert.equal(await ownsBanner(cookie), true, '치장품이 지급된다');
  const fulfilled = await repository.load();
  assert.equal(fulfilled.players[pending.accountId].purchases.length, 1, '재전송이 이중 지급으로 이어지지 않는다');
  assert.equal(fulfilled.checkouts[pending.externalReferenceId].status, 'fulfilled');

  // 다른 이벤트 id로 같은 결제 의도를 또 가리켜도 두 번 주지 않는다.
  const replayNewId = await deliver(purchaseEvent(
    { id: 'event-2' },
    { id: 'purchase-2', accountId: pending.accountId, externalReferenceId: pending.externalReferenceId },
  ));
  assert.equal(replayNewId.response.status, 200);
  assert.equal(replayNewId.payload.ignored, 'checkout already fulfilled');
  assert.equal((await repository.load()).players[pending.accountId].purchases.length, 1);

  // --- 체크아웃 생성 속도 제한 ---
  const spammer = sessionCookie(await call('/api/store/catalog?locale=ko'));
  let limited = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await openCheckout(spammer)).status === 429) limited += 1;
  }
  assert.ok(limited > 0, '체크아웃 생성은 무제한이 아니다');

  console.log('store server check: 카탈로그·국가 해석·가격 계약·서명·재전송·환경·속도 제한 통과');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
