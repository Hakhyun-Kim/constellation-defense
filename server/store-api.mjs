import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_COUNTRY, checkoutItem, isSupportedCountry, marketFor, MARKETS, PRODUCTS, publicCatalog,
} from './catalog.mjs';
import { createNeonCheckout } from './neon-client.mjs';
import { PermanentRejection } from './repository.mjs';

const PLAYER_COOKIE = 'cd_player';
const COUNTRY_COOKIE = 'cd_country';
const PLAYER_RE = /^[a-f0-9-]{36}$/i;
/* 결제 의도는 원장에 기록되므로 무제한 생성은 저장소 고갈로 이어진다. */
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;
const CHECKOUT_LIMIT = 10;
/* 플랫폼이 붙여 주는 지리 헤더. 있으면 브라우저 언어보다 신뢰도가 높다. */
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-appengine-country', 'x-geo-country'];

/* 인계 코드는 사람이 다른 기기에 옮겨 적는다. 그래서 헷갈리는 글자를 뺀다 —
 * O/0, I/1/L 을 섞어 두면 "코드가 안 먹는다"는 문의가 지원 비용이 된다. */
const TRANSFER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TRANSFER_LENGTH = 12;
const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
/* 저장본은 진행도 한 벌이다. 넉넉하되 무제한은 아니게. */
const SAVE_LIMIT = 256 * 1024;

function newTransferCode() {
  /* randomInt 는 거절 표본으로 편향 없이 뽑는다. 소지자 자격이라 %는 쓰지 않는다. */
  const chars = Array.from({ length: TRANSFER_LENGTH }, () => TRANSFER_ALPHABET[randomInt(TRANSFER_ALPHABET.length)]);
  return `CD-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/* 원문은 어디에도 저장하지 않는다. 보여주는 것은 발급 순간 한 번뿐이다. */
const hashTransferCode = (code) => createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('=').map(decodeURIComponent))
      .filter(([key, value]) => key && value),
  );
}

function appendCookie(res, name, value, { secure }) {
  const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`;
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : [cookie]);
}

/* 신원은 두 가지 방법으로 온다. 쿠키는 같은 오리진 웹에서 편하고, Bearer 토큰은
 * 그 밖의 모든 클라이언트에서 유일하게 동작한다 — Unity·Unreal 에는 쿠키 항아리가
 * 없고, 게임이 CDN 에 있고 API 가 다른 도메인이면 SameSite 때문에 쿠키가 끊긴다
 * (Safari 와 Firefox 는 서드파티 쿠키를 기본 차단한다).
 *
 * 둘 다 소지자(bearer) 자격이고 기기에 묶인다는 점에서 위협 모델이 같다. 계정이
 * 있는 게임이라면 스튜디오의 플레이어 id 와 POST /auth/token 이 이 자리를 대신한다. */
function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  return match && PLAYER_RE.test(match[1]) ? match[1] : null;
}

function account(req, res, config) {
  const token = bearerToken(req);
  if (token) return token;
  const current = cookies(req)[PLAYER_COOKIE];
  if (PLAYER_RE.test(current || '')) return current;
  const id = randomUUID();
  appendCookie(res, PLAYER_COOKIE, id, config);
  return id;
}

/* 국가는 절대 게임 UI 언어에서 끌어오지 않는다. Neon은 통화를 playerCountry에
 * 맞춰 강제하므로, 한국어를 영어로 바꿨다는 이유로 US/USD가 나가면 세금과
 * 결제수단이 통째로 틀어진다. 신뢰도 높은 신호부터 순서대로만 본다. */
export function resolveCountry(req) {
  const chosen = String(cookies(req)[COUNTRY_COOKIE] || '').toUpperCase();
  if (isSupportedCountry(chosen)) return chosen;
  for (const header of GEO_HEADERS) {
    const value = String(req.headers[header] || '').toUpperCase();
    if (isSupportedCountry(value)) return value;
  }
  for (const tag of String(req.headers['accept-language'] || '').split(',')) {
    const region = tag.trim().split(';')[0].split('-')[1];
    if (region && isSupportedCountry(region.toUpperCase())) return region.toUpperCase();
  }
  return DEFAULT_COUNTRY;
}

/* successUrl은 반드시 플레이어가 지금 보고 있는 오리진이어야 한다. 다르면
 * 결제 후 다른 호스트로 돌아오고, 세션 쿠키가 따라오지 않아 "결제는 됐는데
 * 내 것이 아니다"가 된다 — localhost와 127.0.0.1처럼 사실상 같아 보이는
 * 주소에서도 그렇다. 실제로 이 함정을 한 번 밟고 나서 추가했다. */
function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : null;
}

async function body(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function readJson(raw) {
  try { return JSON.parse(raw.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('malformed json'), { status: 400 }); }
}

/* 교차 오리진은 토큰으로만 다닌다. Access-Control-Allow-Credentials 를 일부러
 * 보내지 않는 이유가 그것이다 — 쿠키를 교차 오리진으로 끌고 가려는 순간
 * SameSite=None 이 필요해지고, 그건 Safari/Firefox 에서 기본 차단된다. */
function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
  return true;
}

export function verifyWebhook(raw, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const received = String(signature).trim().toLowerCase();
  /* timingSafeEqual은 길이가 다르면 던진다 — 비교 전 길이 확인이 필수. */
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/* 처리 가능한 이벤트면 {purchase} 또는 {refund}, 아니면 {ignored:사유}.
 * 사유가 붙는 경우는 전부 "재시도해도 달라지지 않는" 상황이라 호출부가 2xx로
 * 받아 삼킨다 — Neon 은 비-2xx 를 36시간 재시도한다. */
export function classifyEvent(event, environment) {
  const type = event?.type;
  if (type !== 'purchase.completed' && type !== 'refund.processed') {
    return { ignored: `unhandled type: ${type || 'unknown'}` };
  }
  if (event.version !== 2) return { ignored: `unsupported version: ${event.version}` };
  /* 샌드박스 이벤트가 운영 원장에 닿으면 안 된다 (그 반대도 마찬가지). */
  const sandboxEvent = event.isSandbox === true;
  if (sandboxEvent !== (environment === 'sandbox')) return { ignored: `environment mismatch: isSandbox=${sandboxEvent}` };

  if (type === 'refund.processed') {
    const refund = event.data?.refund;
    if (!event.id || !refund?.id || !refund.purchaseId) return { ignored: 'missing required identifiers' };
    /* 문서의 예시에서 externalReferenceId 가 null 이다. 그래서 purchaseId 가
     * 결제 의도를 되찾는 실질적인 열쇠이고, 참조는 있으면 쓰는 쪽이다. */
    const item = refund.items?.length === 1 ? refund.items[0] : null;
    return {
      refund: {
        eventId: event.id,
        refundId: refund.id,
        purchaseId: refund.purchaseId,
        accountId: refund.accountId || null,
        externalReferenceId: refund.externalReferenceId || null,
        sku: item?.sku || null,
        currency: refund.currency || null,
        totalAmount: refund.totalAmount ?? null,
      },
    };
  }

  const purchase = event.data?.purchase;
  if (purchase?.status !== 'complete') return { ignored: `purchase status: ${purchase?.status}` };
  if (!event.id || !purchase.id || !purchase.accountId || !purchase.externalReferenceId) {
    return { ignored: 'missing required identifiers' };
  }
  if (purchase.items?.length !== 1 || !purchase.items[0]?.sku) return { ignored: 'unsupported item shape' };
  const item = purchase.items[0];
  return {
    purchase: {
      eventId: event.id,
      purchaseId: purchase.id,
      orderNumber: purchase.orderNumber || null,
      accountId: purchase.accountId,
      externalReferenceId: purchase.externalReferenceId,
      sku: item.sku,
      quantity: item.quantity,
      price: item.price ?? null,
      /* 플레이어가 결제 페이지에서 국가를 바꿀 수 있으므로, 금액 대조 기준은
       * 체크아웃을 만든 시점의 통화(initialCurrency)다. */
      currency: purchase.initialCurrency || purchase.currency || null,
      settledCurrency: purchase.currency || null,
    },
  };
}

export function createStoreApi({ repository, config, fetchImpl = fetch, log = console }) {
  const environment = config.environment === 'production' ? 'production' : 'sandbox';
  /* HTTPS 뒤에서는 Secure를 붙인다. PUBLIC_URL이 비어 있으면 요청 오리진으로 판단한다. */
  const cookieOptionsFor = (req) => ({ secure: String(config.publicUrl || requestOrigin(req) || '').startsWith('https://') });

  async function applyOrIgnore(res, run, { eventId, describe, source }) {
    try {
      const result = await run();
      log.info?.(`[store] ${source} ${result.ignored || (result.deferred ? 'refund retained until purchase mapping arrives' : describe(result))}${result.duplicate ? ' (duplicate, no-op)' : ''}`);
      return json(res, 200, { received: true, ...result });
    } catch (error) {
      /* 영구 거절은 200으로 받는다. Neon은 비-2xx를 36시간 재시도하는데,
       * 재시도로 풀릴 수 없는 상황에서 재시도를 부르면 아무도 이득이 없다.
       * 반대로 일시적 실패는 다시 던져서 5xx가 나가야 재시도를 받는다. */
      if (error instanceof PermanentRejection) {
        log.warn?.(`[store] ${source} rejected: ${error.reason} (event ${eventId})`);
        return json(res, 200, { received: true, ignored: error.reason });
      }
      throw error;
    }
  }

  const allowedOrigins = config.allowedOrigins || [];

  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    const corsAllowed = applyCors(req, res, allowedOrigins);
    if (req.method === 'OPTIONS') {
      res.writeHead(corsAllowed ? 204 : 403).end();
      return true;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/store/catalog') {
        const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ko';
        const country = resolveCountry(req);
        /* 토큰으로 다니는 클라이언트(Unity·Unreal·다른 도메인의 웹)는 자기
         * 신원을 알아야 저장할 수 있다. 쿠키만 쓰는 같은 오리진 웹은 무시하면 된다. */
        const playerId = account(req, res, cookieOptionsFor(req));
        return json(res, 200, {
          playerId,
          items: publicCatalog(locale, country),
          country,
          currency: marketFor(country).currency,
          markets: Object.entries(MARKETS).map(([code, market]) => ({ code, currency: market.currency })),
          checkoutMode: config.mock ? 'mock' : 'hosted',
          environment,
        });
      }

      /* 국가는 명시적 선택으로만 바뀐다 — 언어 토글은 여기에 관여하지 않는다. */
      if (req.method === 'POST' && url.pathname === '/api/store/market') {
        const input = readJson(await body(req));
        const country = String(input.country || '').toUpperCase();
        if (!isSupportedCountry(country)) return json(res, 400, { error: 'unsupported country' });
        appendCookie(res, COUNTRY_COOKIE, country, cookieOptionsFor(req));
        return json(res, 200, { country, currency: marketFor(country).currency });
      }

      /* --- 계정 ---
       * 지금까지 신원은 기기에 묶인 소지자 자격이었다. 기기를 바꾸면 산 것이
       * 따라오지 않는다는 뜻이고, 결제 통합에서 그건 가장 흔한 문의다.
       *
       * 인계 코드는 한국·일본 모바일 게임의 관행을 그대로 따른다. 이메일도
       * 비밀번호도 없이 "구매는 기기가 아니라 계정을 따른다"만 성립시킨다.
       * 이것은 인증이 아니라 이전 수단이다 — 코드를 가진 사람이 계정을 가진다.
       * 실제 타이틀이라면 이메일이나 OAuth 가 이 자리에 온다. */
      if (req.method === 'POST' && url.pathname === '/api/account/transfer-code') {
        const accountId = account(req, res, cookieOptionsFor(req));
        const code = newTransferCode();
        const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();
        await repository.issueTransferCode({ accountId, hash: hashTransferCode(code), expiresAt });
        log.info?.('[store] transfer code issued', { accountId });
        /* 코드 원문이 서버를 떠나는 것은 이 응답 한 번뿐이다. */
        return json(res, 201, { code, expiresAt });
      }

      if (req.method === 'POST' && url.pathname === '/api/account/claim') {
        const input = readJson(await body(req));
        const claimed = await repository.claimTransferCode(hashTransferCode(input.code || ''));
        if (!claimed) {
          log.warn?.('[store] transfer code rejected');
          /* 왜 실패했는지(없음/만료/이미 사용) 구분해 주지 않는다 — 코드를
           * 찍어 보는 쪽에 정보를 주는 셈이 된다. */
          return json(res, 404, { error: 'invalid_code' });
        }
        /* 기기가 이 계정을 입는다. 권리는 옮기지 않는다 — 애초에 계정에 있다. */
        appendCookie(res, PLAYER_COOKIE, claimed.accountId, cookieOptionsFor(req));
        log.info?.('[store] transfer code claimed', { accountId: claimed.accountId });
        return json(res, 200, { accountId: claimed.accountId });
      }

      // --- 계정 저장본 ---
      if (req.method === 'GET' && url.pathname === '/api/save') {
        const record = await repository.readSave(account(req, res, cookieOptionsFor(req)));
        if (!record) return json(res, 200, { save: null, version: 0 });
        return json(res, 200, { save: record.save, version: record.version, updatedAt: record.updatedAt });
      }

      if (req.method === 'PUT' && url.pathname === '/api/save') {
        const input = readJson(await body(req, SAVE_LIMIT));
        if (input.save === undefined) return json(res, 400, { error: 'save is required' });
        const result = await repository.writeSave({
          accountId: account(req, res, cookieOptionsFor(req)),
          save: input.save,
          baseVersion: input.baseVersion,
        });
        /* 다른 기기가 그 사이 썼으면 덮지 않고 상대의 것을 돌려준다. 마지막
         * 쓰기가 이기게 두면 두 기기를 오가는 플레이어의 진행도가 조용히 사라진다. */
        if (result.conflict) {
          return json(res, 409, {
            error: 'stale_save',
            version: result.current?.version || 0,
            save: result.current?.save ?? null,
          });
        }
        return json(res, 200, { version: result.current.version, updatedAt: result.current.updatedAt });
      }

      if (req.method === 'GET' && url.pathname === '/api/store/entitlements') {
        return json(res, 200, { entitlements: await repository.entitlements(account(req, res, cookieOptionsFor(req))) });
      }

      if (req.method === 'POST' && url.pathname === '/api/store/checkout') {
        const input = readJson(await body(req));
        const locale = input.locale === 'en' ? 'en' : 'ko';
        const country = resolveCountry(req);
        const resolved = checkoutItem(input.sku, { locale, country });
        if (!resolved) return json(res, 400, { error: 'unknown product' });
        const accountId = account(req, res, cookieOptionsFor(req));
        /* 이미 가진 영구 아이템을 다시 팔지 않는다. 상점 버튼은 비활성이지만
         * UI 는 신뢰 경계 밖이고, 결제 통합에서 이중 청구는 가장 나쁜 결말이다.
         * 환불로 권리가 사라지면 여기도 다시 열린다 — 상태가 아니라 보유가 기준. */
        if (resolved.permanent && (await repository.entitlements(accountId))[resolved.entitlement]) {
          log.info?.(`[store] checkout refused: ${accountId} already owns ${resolved.entitlement}`);
          return json(res, 409, { error: 'already_owned' });
        }
        if (await repository.recentCheckoutCount(accountId, CHECKOUT_WINDOW_MS) >= CHECKOUT_LIMIT) {
          return json(res, 429, { error: 'too many checkout attempts' });
        }
        const externalReferenceId = randomUUID();
        /* PUBLIC_URL을 명시하지 않았으면 요청이 들어온 오리진을 그대로 쓴다.
         * 명시했는데 다르면 쿠키를 잃는 구성이므로 시끄럽게 경고한다. */
        const observed = requestOrigin(req);
        const origin = String(config.publicUrl || observed || '').replace(/\/$/, '');
        if (config.publicUrl && observed && !config.publicUrl.startsWith(observed)) {
          log.warn?.(`[store] PUBLIC_URL(${config.publicUrl})과 요청 오리진(${observed})이 다릅니다 — 결제 후 세션 쿠키를 잃습니다.`);
        }
        const payload = {
          items: [resolved.item],
          externalReferenceId,
          accountId,
          languageLocale: locale === 'ko' ? 'ko-KR' : 'en-US',
          playerCountry: country,
          currency: resolved.currency,
          storeUrl: origin,
          successUrl: `${origin}/?lang=${locale}&purchase=return`,
          cancelUrl: `${origin}/?lang=${locale}&purchase=cancelled`,
        };
        const checkout = config.mock
          ? { checkoutId: `mock-${externalReferenceId}`, redirectUrl: `${origin}/?lang=${locale}&purchase=mock&reference=${externalReferenceId}` }
          : await createNeonCheckout({ apiKey: config.apiKey, apiUrl: config.apiUrl, payload, fetchImpl });
        await repository.recordCheckout({
          externalReferenceId, accountId, sku: resolved.item.sku, entitlement: resolved.entitlement,
          price: resolved.item.price, currency: resolved.currency, country,
          status: 'pending',
          /* Neon 은 redirectUrl 과 token 만 돌려준다 — checkoutId 는 없다. JSON 은
           * undefined 키를 조용히 버리지만 Firestore 는 예외를 던지므로 null 로 고정한다. */
          checkoutId: checkout.checkoutId ?? null,
        });
        return json(res, 201, { checkoutId: checkout.checkoutId, token: checkout.token, redirectUrl: checkout.redirectUrl });
      }

      if (req.method === 'POST' && url.pathname === '/api/webhooks/neon') {
        const raw = await body(req);
        /* 서명 실패만 비-2xx로 남긴다. 인증되지 않은 요청에 200을 주면
         * 설정 오류가 조용히 묻힌다 — 여기서는 시끄러운 편이 낫다. */
        if (!verifyWebhook(raw, req.headers['x-neon-digest'], config.webhookSecret)) {
          log.warn?.('[store] webhook rejected: invalid signature');
          return json(res, 403, { error: 'invalid signature' });
        }
        let event;
        try { event = JSON.parse(raw.toString('utf8')); }
        catch { return json(res, 200, { received: true, ignored: 'malformed json' }); }
        const { purchase, refund, ignored } = classifyEvent(event, environment);
        if (ignored) {
          log.info?.(`[store] webhook ignored: ${ignored}`);
          return json(res, 200, { received: true, ignored });
        }
        if (refund) {
          return applyOrIgnore(res, () => repository.revoke(refund), {
            eventId: refund.eventId,
            source: 'refund webhook',
            describe: (result) => (result.revoked
              ? `revoked ${refund.sku || 'entitlement'} for purchase ${refund.purchaseId}`
              : `marked purchase ${refund.purchaseId} refunded before it was ever granted`),
          });
        }
        return applyOrIgnore(res, () => repository.fulfill(purchase), {
          eventId: purchase.eventId,
          source: 'webhook',
          describe: () => `fulfilled ${purchase.sku} for ${purchase.accountId}`,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/store/mock-complete' && config.mock) {
        const input = readJson(await body(req));
        const pending = await repository.pendingCheckout(input.reference);
        if (!pending || pending.accountId !== account(req, res, cookieOptionsFor(req))) {
          return json(res, 404, { error: 'checkout not found' });
        }
        const mockPurchase = {
          /* 기본은 같은 이벤트 id — 재전송을 흉내 내어 멱등성을 보여줄 수 있다.
           * distinct 를 주면 새 id 로 보낸다: "다른 지급 이벤트가 뒤늦게 같은
           * 결제를 가리키는" 경우라, 멱등성이 아니라 결제 의도의 상태가
           * 막아야 하는 상황이다. 둘은 다른 방어선이고 섞이면 안 된다. */
          eventId: input.distinct ? `mock-event-${input.reference}-${Date.now()}` : `mock-event-${input.reference}`,
          purchaseId: `mock-purchase-${input.reference}`,
          orderNumber: 'MOCK-DEMO',
          accountId: pending.accountId,
          externalReferenceId: input.reference,
          sku: pending.sku,
          quantity: 1,
          price: pending.price,
          currency: pending.currency,
        };
        return applyOrIgnore(res, () => repository.fulfill(mockPurchase), {
          eventId: mockPurchase.eventId,
          source: 'mock',
          describe: () => `fulfilled ${mockPurchase.sku} for ${mockPurchase.accountId}`,
        });
      }

      /* 모의 환불. 안내 투어가 구매의 수명 전체 — 지급과 회수 — 를 화면에서
       * 보여줄 수 있어야 하기 때문에 있다. mock-complete 와 같은 규칙을 따른다:
       * 모의 모드에서만 등록되고, 자기 결제만 건드릴 수 있고, 실제 웹훅과 똑같이
       * repository.revoke() 라는 같은 문을 지난다. */
      if (req.method === 'POST' && url.pathname === '/api/store/mock-refund' && config.mock) {
        const input = readJson(await body(req));
        const pending = await repository.pendingCheckout(input.reference);
        if (!pending || pending.accountId !== account(req, res, cookieOptionsFor(req))) {
          return json(res, 404, { error: 'checkout not found' });
        }
        const mockRefund = {
          eventId: `mock-refund-event-${input.reference}`,
          refundId: `mock-refund-${input.reference}`,
          purchaseId: pending.purchaseId,
          accountId: pending.accountId,
          /* 문서의 실제 환불 예시가 그렇듯 참조는 비워 둔다 — purchaseId 로
           * 결제 의도를 되찾는 경로를 데모에서도 그대로 태운다. */
          externalReferenceId: null,
          sku: pending.sku,
          currency: pending.currency,
        };
        return applyOrIgnore(res, () => repository.revoke(mockRefund), {
          eventId: mockRefund.eventId,
          source: 'mock refund',
          describe: (result) => (result.revoked
            ? `revoked ${mockRefund.sku} for ${mockRefund.accountId}`
            : `marked ${mockRefund.purchaseId} refunded before it was granted`),
        });
      }

      return json(res, 404, { error: 'not found' });
    } catch (error) {
      log.error?.(error);
      return json(res, error.status || 500, { error: error.status ? error.message : 'store service unavailable' });
    }
  };
}

export { PRODUCTS };
