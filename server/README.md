# Payment service (`server/`)

This directory is the payment service for the Neon Hosted Checkout integration in Constellation Defense. It is a standalone Node.js HTTP service. It creates checkouts, verifies Neon webhooks, and writes entitlements. It serves no game files. The game engine does not depend on it: `src/engine/` knows nothing about this code. The store UI in `src/app/` talks to it over HTTP, and web and native clients share the same service.

## File map

| File | What it owns |
|---|---|
| `index.mjs` | Standalone API entry point. Validates configuration, refuses to start on a fatal problem, serves `/healthz` and `/readyz`, drains on `SIGTERM` and `SIGINT`. |
| `store-api.mjs` | HTTP routes, player identity (Bearer token, then cookie), billing country resolution, webhook signature check and event classification, CORS. |
| `catalog.mjs` | SKU allowlist and prices. The only place a price is written. Markets (`KR`/KRW, `US`/USD) and `Intl` display formatting. |
| `repository.mjs` | JSON ledger for one process: checkout intents, entitlements, processed event ids, refunds, transfer codes, save snapshots. Defines `PermanentRejection`. |
| `firestore-repository.mjs` | The same interface on Firestore transactions, for more than one instance. Loaded only when selected. |
| `repository-factory.mjs` | Picks JSON or Firestore from configuration. |
| `neon-client.mjs` | The Neon HTTP adapter: create checkout, get purchase, create an item-level refund. |
| `config.mjs` | Reads environment variables once and reports fatal problems and warnings. |
| `logger.mjs` | Text logs for local use, JSON logs for log collectors. |
| Outside `server/` | `src/app/neon-store.js` (store UI, checkout start, return polling, transfer code UI), `src/app/neontour.js` (checkout inspector, `?tour=neon`), `src/app/neon-events.js` (redacted events for the inspector), `scripts/payment-excerpts.mjs` (bundles source excerpts at build time), `start-demo.bat` and `start-demo.command` (one-click local run). |

## HTTP routes

Store routes live under `/api/`. Identity comes from `Authorization: Bearer <uuid>` first, then the `cd_player` cookie; a request with neither gets a new UUID set as an `HttpOnly` cookie. Country comes from the `cd_country` cookie, then the `cf-ipcountry`, `x-vercel-ip-country`, `x-appengine-country` and `x-geo-country` headers, then the `Accept-Language` region, then `KR`. `OPTIONS` on any `/api/` path answers 204 for an origin listed in `ALLOWED_ORIGINS` and 403 otherwise.

| Method | Path | What it does | Notes |
|---|---|---|---|
| `GET` | `/healthz`, `/readyz` | Liveness (always 200). Readiness calls `repository.healthy()` and reports `backend` and `environment`. | `index.mjs` only. `/readyz` is 503 while draining or when the check throws. |
| `GET` | `/api/store/catalog` | Priced, localized item list plus `playerId`, `country`, `currency`, `markets`, `checkoutMode`, `environment`. | `?locale=en` changes names only. Assigns identity. |
| `POST` | `/api/store/market` | Sets the billing country cookie. | 400 for an unsupported country. |
| `POST` | `/api/store/checkout` | Resolves `{sku, locale}` against the catalog, records a pending intent, creates the Neon checkout, returns `redirectUrl`. | 400 unknown product. 409 `already_owned`. 429 after 10 checkouts in 10 minutes. 502 when Neon rejects. Mock mode returns a local redirect. |
| `GET` | `/api/store/entitlements` | What the caller owns. | Polled after the return redirect. |
| `POST` | `/api/webhooks/neon` | Verifies `x-neon-digest` (HMAC-SHA256 over the raw body), classifies the event, calls `repository.fulfill` or `repository.revoke`. | Policy below. |
| `POST` | `/api/store/refund` | Hosted mode only. Asks Neon for an item-level refund of the caller's own purchase. Revokes nothing itself; the `refund.processed` webhook does. | 202. 404 not owned. 409 not refundable. |
| `POST` | `/api/store/mock-complete`, `/api/store/mock-refund` | Mock mode only. Feed a synthetic purchase into `repository.fulfill`, or a synthetic refund into `repository.revoke`. | 404 unless the caller owns the intent. |
| `POST` | `/api/account/transfer-code` | Issues a 24-hour, single-use code for the caller's account. | 201. The only response carrying the plaintext code; the ledger stores a SHA-256 hash. |
| `POST` | `/api/account/claim` | Switches the device to the account behind a code. | 404 `invalid_code` for missing, expired and used codes alike. |
| `GET` | `/api/save` | Reads the account save snapshot. | `{save: null, version: 0}` when empty. |
| `PUT` | `/api/save` | Writes a snapshot with `baseVersion`. | 409 `stale_save` with the current snapshot on a version mismatch. 256 KiB body limit. |

Webhook response policy, as implemented in `store-api.mjs` and the repositories:

- Bad or missing signature: 403 `{error: 'invalid signature'}`.
- Malformed JSON, unhandled type, version other than 2, `isSandbox` not matching `NEON_ENVIRONMENT`, missing ids, item shape other than one SKU, or purchase status other than `complete`: 200 `{received: true, ignored: <reason>}`.
- `PermanentRejection` from the repository (unknown reference, intent not `pending`, account, SKU, quantity or amount mismatch): 200 `{received: true, ignored: <reason>}` plus a warning log.
- Event id already processed: 200 `{received: true, duplicate: true}`. Refund for a purchase that has no intent yet: 200 `{received: true, deferred: true, revoked: false}`; the refund is kept by purchase id and a later fulfilment of it is refused.
- A body over 64 KiB: 413. Any other thrown error, which is what a storage failure is: 500 `{error: 'store service unavailable'}`, so Neon retries.

## How to run

```bash
cp .env.example .env     # NEON_MOCK_CHECKOUT=1 is already set; no credentials needed
npm run serve            # game files + API on http://127.0.0.1:8642
npm run service          # API only, same port, with /healthz and /readyz
```

Both scripts load `.env` through `node --env-file-if-exists=.env`. The JSON ledger is written to `.data/neon-store.json`. The dev server binds `127.0.0.1` and logs configuration problems as warnings. The service binds `0.0.0.0` and exits on a fatal problem.

Hosted (sandbox) mode reads these variables in `config.mjs`: `NEON_MOCK_CHECKOUT`, `NEON_API_KEY`, `NEON_WEBHOOK_SECRET`, `NEON_API_URL`, `NEON_ENVIRONMENT` (`sandbox` or `production`), `PUBLIC_URL`, `ALLOWED_ORIGINS` (comma separated), `PORT`, `HOST` and `LOG_FORMAT` (`text` or `json`). With mock mode off, a missing `NEON_API_KEY`, `NEON_WEBHOOK_SECRET` or `PUBLIC_URL` is fatal for the service. `NEON_MOCK_CHECKOUT=1` with `NEON_ENVIRONMENT=production` is always fatal. Storage: `STORE_BACKEND=firestore` selects Firestore; any other value means the JSON ledger. Firestore uses `GOOGLE_CLOUD_PROJECT` when set and keeps data under `neon-store/<NEON_ENVIRONMENT>`. The SDK is loaded by dynamic import only when selected.

Container: the root `Dockerfile` (`node:22-slim`, `npm ci --omit=dev`) sets `HOST=0.0.0.0`, `LOG_FORMAT=json` and `STORE_BACKEND=firestore`, then runs `node server/index.mjs`. `deploy/cloud-run.sh` deploys it to Cloud Run with `NEON_API_KEY` and `NEON_WEBHOOK_SECRET` held in Secret Manager; `--dry-run` prints what it would run.

## Invariants

- Prices, currency and country are owned by the server. The client sends `{sku, locale}` only.
- Entitlements are written in one place, `repository.fulfill()`, and only from a signed webhook. The redirect grants nothing, because the webhook can arrive later.
- A webhook response is decided by one question: would a retry help. Neon retries any non-2xx for 36 hours. What a retry cannot fix answers 200 `{ignored}` with a log line. Only a bad signature answers 403. Only a storage failure answers 5xx.
- Prices are integers at 100 times the base unit; display strings are derived with `Intl.NumberFormat`. KRW 4,900 is `490000`. Never hand-write a display price.
- Country is never inferred from the game language. `?lang=en` must not change the billing country.
- Mock mode goes through the same `fulfill` and `revoke` paths as real webhooks.

## Verify

```bash
npm run store:check                                          # scripts/store-server-check.mjs
npm run service:check                                        # scripts/service-check.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run store:check   # adds the Firestore suite
```

`store:check` runs the API over real HTTP on an ephemeral port against the JSON ledger and covers catalog pricing, country resolution, ignored client prices, forged and missing signatures, replay, environment mismatch, wrong account and amount, refund revocation by purchase id and by reference, early refunds, the already-owned 409, the rate limit, transfer codes, save versions, the Neon adapter with a stubbed `fetch`, return URLs and the hosted refund route; it also runs `store-regression-check.mjs`, which proves that a failed JSON commit grants nothing and stays retryable. With `FIRESTORE_EMULATOR_HOST` set to a running emulator (the script's comment uses `gcloud emulators firestore start --host-port=127.0.0.1:8080`), the same suite runs again against Firestore; otherwise it prints a skip.

`service:check` covers configuration rejection (missing keys, mock in production), `PORT` and `HOST` defaults, JSON and text log formats, `/healthz`, `/readyz`, that `/`, `/index.html` and `/dist/game.js` are 404 on the service, and that the port is closed after shutdown; it also runs `serve-check.mjs`, which starts `scripts/serve.mjs` and checks that `.env`, the ledger, `.git/` and source files are 404 while public assets load. Both are part of `npm run check`.

## Further reading (separate repository)

- [00 Integration guide](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/00-integration-guide.md)
- [01 Architecture](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/01-architecture.md)
- [02 Checkout flow](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/02-checkout-flow.md)
- [03 Decisions and assumptions](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/03-decisions-and-assumptions.md)
- [08 Storage and identity](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/08-storage-and-identity.md)
- [09 Sandbox run](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/09-sandbox-run.md)
- [12 Current integration review](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/12-review.md)
