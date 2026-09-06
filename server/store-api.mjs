import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_COUNTRY, checkoutItem, isSupportedCountry, marketFor, MARKETS, PRODUCTS, publicCatalog,
} from './catalog.mjs';
import { createNeonCheckout, createNeonRefund, getNeonPurchase } from './neon-client.mjs';
import { PermanentRejection } from './repository.mjs';

const PLAYER_COOKIE = 'cd_player';
const COUNTRY_COOKIE = 'cd_country';
const PLAYER_RE = /^[a-f0-9-]{36}$/i;
/* Checkout intents consume ledger space, so creation must be bounded. */
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;
const CHECKOUT_LIMIT = 10;
/* Platform geography headers take precedence over browser locale. */
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

/* Never derive billing country from game UI language. Neon aligns currency with playerCountry; a language toggle must not change tax or payment-method selection. Apply billing signals in priority order. */
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
        /* Return identity so token-based web and native clients can persist it; same-origin cookie clients may ignore it. */
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

      /* Billing country changes only through explicit selection, independently of language. */
      if (req.method === 'POST' && url.pathname === '/api/store/market') {
        const input = readJson(await body(req));
        const country = String(input.country || '').toUpperCase();
        if (!isSupportedCountry(country)) return json(res, 400, { error: 'unsupported country' });
        appendCookie(res, COUNTRY_COOKIE, country, cookieOptionsFor(req));
        return json(res, 200, { country, currency: marketFor(country).currency });
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
        const country = resolveCountry(req);
        const resolved = checkoutItem(input.sku, { locale, country });
        if (!resolved) return json(res, 400, { error: 'unknown product' });
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
          price: resolved.item.price, currency: resolved.currency, country,
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
