import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_COUNTRY, checkoutItem, isCountryCode, MARKETS, PRODUCTS, priceList, publicCatalog,
} from './catalog.mjs';
import { createNeonCheckout, createNeonRefund, getNeonPurchase } from './neon-client.mjs';
import { clientIp, createPricing } from './pricing.mjs';
import { PermanentRejection } from './repository.mjs';

const PLAYER_COOKIE = 'cd_player';
const COUNTRY_COOKIE = 'cd_country';
const PLAYER_RE = /^[a-f0-9-]{36}$/i;
/* Checkout intents consume ledger space, so creation must be bounded. */
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;
const CHECKOUT_LIMIT = 10;
/* Platform geography headers are trustworthy only behind a proxy that sets them and strips the client's copy; otherwise any caller can declare its own country with a header. Deployments opt in with TRUST_GEO_HEADERS. */
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-appengine-country', 'x-geo-country'];

/* Avoid ambiguous O/0 and I/1/L in manually transferred codes to reduce transcription failures. */
const TRANSFER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TRANSFER_LENGTH = 12;
const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
/* Bound a complete progress snapshot without making the size limit unnecessarily restrictive. */
const SAVE_LIMIT = 256 * 1024;

function newTransferCode() {
  /* randomInt uses unbiased rejection sampling; do not use modulo for bearer credentials. */
  const chars = Array.from({ length: TRANSFER_LENGTH }, () => TRANSFER_ALPHABET[randomInt(TRANSFER_ALPHABET.length)]);
  return `CD-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/* Never store plaintext codes; return them only at issuance. */
const hashTransferCode = (code) => createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');

/* A malformed cookie set by any other app on the same origin must not turn every store call into a 500. */
function cookies(req) {
  const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => {
        const trimmed = part.trim();
        const at = trimmed.indexOf('=');
        return at < 0 ? [trimmed, ''] : [decode(trimmed.slice(0, at)), decode(trimmed.slice(at + 1))];
      })
      .filter(([key, value]) => key && value),
  );
}

/* Account ids are bearer credentials; logs carry a short one-way handle instead of the credential itself. */
const who = (accountId) => (accountId ? createHash('sha256').update(String(accountId)).digest('hex').slice(0, 12) : 'anonymous');

function appendCookie(res, name, value, { secure }) {
  const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`;
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : [cookie]);
}

/* Same-origin browsers can use cookies; native and separately hosted clients use Bearer tokens. Both are bearer credentials tied to a device until transferred. A production game should integrate its existing player identity/token service here. */
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

function chosenCountry(req) {
  const chosen = String(cookies(req)[COUNTRY_COOKIE] || '').toUpperCase();
  return isCountryCode(chosen) ? chosen : null;
}

function geoHeaderCountry(req) {
  for (const header of GEO_HEADERS) {
    const value = String(req.headers[header] || '').toUpperCase();
    if (isCountryCode(value)) return value;
  }
  return null;
}

/* Never derive billing country from a language signal. Neon aligns currency, payment methods and tax jurisdiction with playerCountry, so this value declares where the player lives: the game's ko/en toggle and the browser's Accept-Language are both language, and an English browser in Seoul is not a US resident. Billing country therefore comes from an explicit market selection, then a location — platform geography from a proxy the deployment trusts, or Neon's geolocation of the client address (createStoreApi's locate, which needs a network call) — then the default market. This is the part that needs no call. */
export function resolveCountry(req, { trustGeoHeaders = false } = {}) {
  return chosenCountry(req) || (trustGeoHeaders ? geoHeaderCountry(req) : null) || DEFAULT_COUNTRY;
}

/* A weak signal may recommend a market; it may not declare one. The browser's region subtag is enough to offer a visitor the currency they probably expect, and not nearly enough to tell a merchant of record where they live — so it produces a visible suggestion the player accepts with a click, which is then an explicit choice, and never a silent country. Suppressed once the player has chosen, and whenever it agrees with what is already resolved. */
export function suggestMarket(req, resolved) {
  if (chosenCountry(req)) return null;
  for (const tag of String(req.headers['accept-language'] || '').split(',')) {
    const region = tag.trim().split(';')[0].split('-')[1];
    const country = region ? region.toUpperCase() : '';
    if (isCountryCode(country)) return country === resolved ? null : country;
  }
  return null;
}

/* One recommendation at most, and it is only ever offered. A location that disagrees with the billing country is worth one line — travelling, a VPN, or a stale choice — and the player decides; a location that agrees needs nothing, and a browser region never argues with it. With no location at all, the browser's region is the weaker hint worth the same line. */
export function recommendMarket(req, { country, located }) {
  if (located) return located === country ? null : { country: located, reason: 'location' };
  const browser = suggestMarket(req, country);
  return browser ? { country: browser, reason: 'browser' } : null;
}

/* Return to the player's original host to preserve session cookies, even when localhost and 127.0.0.1 appear equivalent. A mismatched host previously made successful purchases appear unowned. */
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

/* Cross-origin clients use tokens, not credentialed cookies. Avoid depending on third-party cookie support. */
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
  /* timingSafeEqual throws on unequal lengths; validate lengths first. */
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/* Classify supported events as purchase/refund and permanently unsupported events as ignored with a reason. Acknowledge permanent failures with 2xx to avoid futile retries. */
export function classifyEvent(event, environment) {
  const type = event?.type;
  if (type !== 'purchase.completed' && type !== 'refund.processed') {
    return { ignored: `unhandled type: ${type || 'unknown'}` };
  }
  if (event.version !== 2) return { ignored: `unsupported version: ${event.version}` };
  /* Sandbox events must never modify production data, or vice versa. */
  const sandboxEvent = event.isSandbox === true;
  if (sandboxEvent !== (environment === 'sandbox')) return { ignored: `environment mismatch: isSandbox=${sandboxEvent}` };

  if (type === 'refund.processed') {
    const refund = event.data?.refund;
    if (!event.id || !refund?.id || !refund.purchaseId) return { ignored: 'missing required identifiers' };
    /* The documented refund example has a null externalReferenceId; purchaseId is the primary fallback lookup key. */
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
      /* Players can change country on the hosted page, so amount validation also considers the original checkout currency. */
      currency: purchase.initialCurrency || purchase.currency || null,
      settledCurrency: purchase.currency || null,
    },
  };
}

export function createStoreApi({ repository, config, fetchImpl = fetch, log = console }) {
  const environment = config.environment === 'production' ? 'production' : 'sandbox';
  /* Use Secure cookies behind HTTPS; fall back to the request origin when PUBLIC_URL is unset. */
  const cookieOptionsFor = (req) => ({
    secure: String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
      || String(config.publicUrl || requestOrigin(req) || '').startsWith('https://'),
  });

  async function applyOrIgnore(res, run, { eventId, describe, source }) {
    try {
      const result = await run();
      log.info?.(`[store] ${source} ${result.ignored || (result.deferred ? 'refund retained until purchase mapping arrives' : describe(result))}${result.duplicate ? ' (duplicate, no-op)' : ''}`);
      return json(res, 200, { received: true, ...result });
    } catch (error) {
      /* Acknowledge permanent rejections with 200; rethrow transient storage failures as 5xx so retries can recover them. */
      if (error instanceof PermanentRejection) {
        log.warn?.(`[store] ${source} rejected: ${error.reason} (event ${eventId})`);
        return json(res, 200, { received: true, ignored: error.reason });
      }
      throw error;
    }
  }

  const allowedOrigins = config.allowedOrigins || [];
  const pricing = createPricing({ config, fetchImpl, log });

  /* Where to bill, why, and at what prices. An explicit selection is the player's statement and wins. A location comes next: a geography header from a trusted proxy, otherwise Neon's geolocation of the client address — the lookup that also returns that country's prices. The default market is last. The address is looked up under a selection too, so a location that disagrees can be offered as a switch. */
  async function locate(req) {
    const chosen = chosenCountry(req);
    const header = config.trustGeoHeaders ? geoHeaderCountry(req) : null;
    const byIp = header ? null : await pricing.forIp(clientIp(req, config));
    const located = header || byIp?.country || null;
    const country = chosen || located || DEFAULT_COUNTRY;
    const source = chosen ? 'selection' : header ? 'geo-header' : located ? 'ip' : 'default';
    const localized = byIp?.country === country ? byIp : await pricing.forCountry(country);
    return { country, source, located, localized };
  }

  /* Why buying is off, when it is: Neon will not sell there, or a hosted checkout would have to guess a currency for a country nobody priced. Mock mode keeps selling on the reference row — no one is billed. */
  const unavailableReason = ({ unpriced }, localized) => (localized?.supported === false ? 'region_unavailable'
    : !config.mock && unpriced ? 'pricing_unavailable' : null);

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
        const where = await locate(req);
        const prices = priceList(where.country, where.localized);
        /* Return identity so token-based web and native clients can persist it; same-origin cookie clients may ignore it. */
        const playerId = account(req, res, cookieOptionsFor(req));
        const suggested = recommendMarket(req, where);
        return json(res, 200, {
          playerId,
          items: publicCatalog(locale, prices),
          country: where.country,
          /* How the country was decided: selection, geo-header, ip or default. */
          countrySource: where.source,
          currency: prices.currency,
          /* Who priced the list: Neon's pricing sheet ('neon') or server/catalog.mjs ('catalogue'). */
          priceSource: prices.source,
          /* Neon serves this country through its Global Store (USD, international cards). Only Neon's answer sets it. */
          globalStore: prices.globalStore,
          /* No row here and no answer from Neon: the USD row stands in as a reference. */
          unpriced: prices.unpriced,
          unavailable: unavailableReason(prices, where.localized),
          /* Offered, not applied: the client shows it as a one-click switch. */
          suggestion: suggested
            ? { ...suggested, currency: priceList(suggested.country, await pricing.forCountry(suggested.country)).currency }
            : null,
          markets: Object.entries(MARKETS).map(([code, market]) => ({ code, currency: market.currency })),
          checkoutMode: config.mock ? 'mock' : 'hosted',
          environment,
        });
      }

      /* Billing country changes only through explicit selection, independently of language. */
      if (req.method === 'POST' && url.pathname === '/api/store/market') {
        const input = readJson(await body(req));
        const country = String(input.country || '').toUpperCase();
        /* Any real country is selectable: Neon's sheet prices it, or the catalogue's rows do. */
        if (!isCountryCode(country)) return json(res, 400, { error: 'unsupported country' });
        appendCookie(res, COUNTRY_COOKIE, country, cookieOptionsFor(req));
        return json(res, 200, { country, currency: priceList(country, await pricing.forCountry(country)).currency });
      }

      /* Account transfer provides continuity without email/password signup. The code is a bearer credential: whoever has it can claim the account. A production title should integrate its existing authentication or OAuth flow. */
      if (req.method === 'POST' && url.pathname === '/api/account/transfer-code') {
        const accountId = account(req, res, cookieOptionsFor(req));
        const code = newTransferCode();
        const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();
        await repository.issueTransferCode({ accountId, hash: hashTransferCode(code), expiresAt });
        log.info?.('[store] transfer code issued', { account: who(accountId) });
        /* This is the only response exposing the plaintext transfer code. */
        return json(res, 201, { code, expiresAt });
      }

      if (req.method === 'POST' && url.pathname === '/api/account/claim') {
        const input = readJson(await body(req));
        const claimed = await repository.claimTransferCode(hashTransferCode(input.code || ''));
        if (!claimed) {
          log.warn?.('[store] transfer code rejected');
          /* Use one failure response for missing, expired and consumed codes to avoid leaking guessing feedback. */
          return json(res, 404, { error: 'invalid_code' });
        }
        /* Switch the device's account identity; entitlements already belong to that account. */
        appendCookie(res, PLAYER_COOKIE, claimed.accountId, cookieOptionsFor(req));
        log.info?.('[store] transfer code claimed', { account: who(claimed.accountId) });
        return json(res, 200, { accountId: claimed.accountId });
      }

      // Account save snapshots.
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
        /* Return a conflict and the current snapshot on a stale version rather than silently overwriting another device's progress. */
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
        const { country, localized } = await locate(req);
        const resolved = checkoutItem(input.sku, { locale, country, localized });
        if (!resolved) return json(res, 400, { error: 'unknown product' });
        const unavailable = unavailableReason(resolved, localized);
        if (unavailable) return json(res, unavailable === 'region_unavailable' ? 403 : 503, { error: unavailable });
        const accountId = account(req, res, cookieOptionsFor(req));
        /* Enforce permanent-item ownership on the server, beyond disabled UI controls. A refunded entitlement becomes purchasable again. */
        if (resolved.permanent && (await repository.entitlements(accountId))[resolved.entitlement]) {
          log.info?.(`[store] checkout refused: ${who(accountId)} already owns ${resolved.entitlement}`);
          return json(res, 409, { error: 'already_owned' });
        }
        if (await repository.recentCheckoutCount(accountId, CHECKOUT_WINDOW_MS) >= CHECKOUT_LIMIT) {
          return json(res, 429, { error: 'too many checkout attempts' });
        }
        const externalReferenceId = randomUUID();
        /* Return the player to the page that started checkout. An allowlisted
         * cross-origin browser announces itself via the Origin header, and may
         * add a validated same-origin path (a Pages project site lives under a
         * path Origin cannot carry). Otherwise PUBLIC_URL, then the request
         * origin, apply as before. The return URL also carries api=<this
         * service> so the arriving page polls the right payment service. */
        const observed = requestOrigin(req);
        const clientOrigin = String(req.headers.origin || '');
        /* returnPath may carry view parameters (spectate/inspector) so the
         * return resumes the same mode; validate path and query separately. */
        const [rawPath = '', rawQuery = ''] = String(input.returnPath || '').split('?');
        const returnPath = /^\/[\w\-./]*$/.test(rawPath) && !rawPath.includes('..') ? rawPath.replace(/\/$/, '') : '';
        /* Reserved keys are the server's to set: a carried api= or purchase= must never shadow them. */
        const carriedParams = new URLSearchParams(/^[\w\-.=&%~]*$/.test(rawQuery) ? rawQuery : '');
        for (const reserved of ['api', 'purchase', 'reference', 'sku', 'lang']) carriedParams.delete(reserved);
        const returnQuery = carriedParams.toString();
        const origin = ((config.allowedOrigins || []).includes(clientOrigin)
          ? clientOrigin + returnPath
          : String(config.publicUrl || observed || '')).replace(/\/$/, '');
        if (config.publicUrl && observed && !config.publicUrl.startsWith(observed) && !(config.allowedOrigins || []).includes(clientOrigin)) {
          log.warn?.(`[store] PUBLIC_URL (${config.publicUrl}) differs from the request origin (${observed}); a browser on that origin loses its session cookie on return unless its Origin is in ALLOWED_ORIGINS`);
        }
        const carried = returnQuery && (config.allowedOrigins || []).includes(clientOrigin) ? `${returnQuery}&` : '';
        const apiParam = `&api=${encodeURIComponent(String(observed || '').replace(/\/$/, ''))}`;
        const payload = {
          items: [resolved.item],
          externalReferenceId,
          accountId,
          languageLocale: locale === 'ko' ? 'ko-KR' : 'en-US',
          playerCountry: country,
          currency: resolved.currency,
          storeUrl: origin,
          successUrl: `${origin}/?${carried}lang=${locale}&purchase=return&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,
          cancelUrl: `${origin}/?${carried}lang=${locale}&purchase=cancelled&sku=${encodeURIComponent(resolved.item.sku)}${apiParam}`,
        };
        const checkout = config.mock
          ? { checkoutId: `mock-${externalReferenceId}`, redirectUrl: `${origin}/?${carried}lang=${locale}&purchase=mock&reference=${externalReferenceId}${apiParam}` }
          : await createNeonCheckout({ apiKey: config.apiKey, apiUrl: config.apiUrl, payload, fetchImpl });
        /* Neon names the checkout identifier `id`; the mock adapter uses checkoutId. Null, not undefined: Firestore rejects undefined. */
        const checkoutId = checkout.id ?? checkout.checkoutId ?? null;
        await repository.recordCheckout({
          externalReferenceId, accountId, sku: resolved.item.sku, entitlement: resolved.entitlement,
          /* A tier-priced intent has no amount of ours: price is null and Neon's quote is kept beside it. */
          price: resolved.item.price ?? null, priceTierCode: resolved.item.priceTierCode ?? null, quotedPrice: resolved.quotedPrice,
          currency: resolved.currency, country,
          status: 'pending',
          checkoutId,
        });
        return json(res, 201, { checkoutId, token: checkout.token, redirectUrl: checkout.redirectUrl });
      }

      if (req.method === 'POST' && url.pathname === '/api/webhooks/neon') {
        const raw = await body(req);
        /* Reject invalid signatures explicitly; acknowledging unauthenticated requests would hide configuration errors. */
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
              : `marked purchase ${refund.purchaseId} refunded (no grant of its own to remove)`),
          });
        }
        return applyOrIgnore(res, () => repository.fulfill(purchase), {
          eventId: purchase.eventId,
          source: 'webhook',
          describe: () => `fulfilled ${purchase.sku} for ${who(purchase.accountId)}`,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/store/mock-complete' && config.mock) {
        const input = readJson(await body(req));
        const pending = await repository.pendingCheckout(input.reference);
        if (!pending || pending.accountId !== account(req, res, cookieOptionsFor(req))) {
          return json(res, 404, { error: 'checkout not found' });
        }
        const mockPurchase = {
          /* Default IDs exercise event replay. distinct sends a new event for the same checkout to exercise intent-state validation instead of deduplication. */
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

      /* Hosted-mode self-refund, so the shared demo can show the whole
       * lifecycle. Account-scoped: only the purchase owner may request it.
       * The route only ASKS Neon (item-level body — the empty-body path is a
       * recorded sandbox 500); the entitlement is revoked exclusively by the
       * signed refund.processed webhook that follows, which the client
       * observes by polling. A production title would gate refunds behind
       * support tooling rather than a player-facing button. */
      if (req.method === 'POST' && url.pathname === '/api/store/refund' && !config.mock) {
        const input = readJson(await body(req));
        const resolved = checkoutItem(input.sku, { locale: 'en', country: DEFAULT_COUNTRY });
        if (!resolved) return json(res, 400, { error: 'unknown product' });
        const accountId = account(req, res, cookieOptionsFor(req));
        const owned = (await repository.entitlements(accountId))[resolved.entitlement];
        if (!owned?.purchaseId) return json(res, 404, { error: 'not owned' });
        const purchase = await getNeonPurchase({
          apiKey: config.apiKey, apiUrl: config.apiUrl, purchaseId: owned.purchaseId, fetchImpl,
        });
        const item = (purchase.items || []).find((entry) => entry.sku === input.sku && entry.refundableQuantity > 0);
        if (!item) return json(res, 409, { error: 'not refundable' });
        const refund = await createNeonRefund({
          apiKey: config.apiKey, apiUrl: config.apiUrl,
          purchaseId: owned.purchaseId, itemId: item.id, fetchImpl,
        });
        log.info?.(`[store] refund requested for ${input.sku} (${who(accountId)}); revocation follows the webhook`);
        return json(res, 202, { requested: true, refundId: refund.refundId || refund.id || null });
      }

      /* Mock-only refunds validate account ownership and use repository.revoke(), the same entry point as real refund webhooks. */
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
          /* Omit the external reference to exercise the purchaseId lookup used by documented refund events. */
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
