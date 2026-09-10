# deploy/

`cloud-run.sh` deploys the payment service (`server/index.mjs`, built from the root `Dockerfile`) to Google Cloud Run. The Neon keys go into Secret Manager. The ledger goes into Firestore. The script is idempotent: run it again to update.

## Requirements

- bash. The script runs in Git Bash on Windows, macOS, Linux, or Cloud Shell.
- The gcloud CLI, an authenticated account, and a project with billing.
- curl, used by the smoke checks.
- Run it from the repository checkout. It exits if `Dockerfile` or `server/index.mjs` is missing.
- `NEON_API_KEY` and `NEON_WEBHOOK_SECRET`, read from `.env` (or `--env-file`). Missing values are prompted for with hidden input. Values are piped straight into Secret Manager and are never echoed. The script notes that the source upload honors `.gitignore`, so `.env` and `.data` stay on the machine.

## What it does, in order

1. Enables the APIs: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Firestore.
2. Creates the `(default)` Firestore database (Native mode) in the region if it does not exist.
3. Enables a TTL policy on `expiresAt` for the `checkouts`, `processedEvents`, `rateLimits` and `transferCodes` collection groups (idempotent, `--async`), so expired intents, dedup records, limiter docs and transfer codes are actually deleted.
4. Creates the secrets `neon-api-key` and `neon-webhook-secret` if missing, then adds a new version of each from the env file or the prompt. `--skip-secrets` leaves the existing versions unchanged.
5. Grants the compute default service account `roles/secretmanager.secretAccessor` on both secrets, plus `roles/datastore.user` and `roles/cloudbuild.builds.builder` on the project. The last binding is needed because projects created since 2024 no longer give that account the Cloud Build roles, so a `--source` deploy fails reading its own upload.
6. Runs `gcloud run deploy --source .` with `--allow-unauthenticated`, `--min-instances 0 --max-instances 1 --memory 512Mi`. Environment: `NEON_MOCK_CHECKOUT=0`, `NEON_ENVIRONMENT=sandbox`, `STORE_BACKEND=firestore`, `LOG_FORMAT=json`, `GOOGLE_CLOUD_PROJECT`, `PUBLIC_URL`, `ALLOWED_ORIGINS`. Secrets are mounted as `NEON_API_KEY` and `NEON_WEBHOOK_SECRET` (`:latest`).
7. Smoke checks against the service URL: `GET /api/store/catalog?locale=en` expects 200 (liveness), `GET /readyz` expects 200 (Firestore reachable), a `POST /api/webhooks/neon` with a forged `x-neon-digest` expects 403, which proves the secret is loaded, and an `OPTIONS /api/store/catalog` preflight sent with the last `--allowed-origins` entry as `Origin` (the hosted client, `https://hakhyun-kim.github.io` by default) expects 204, which proves CORS still admits the shared link. `/healthz` is not probed because Google's frontend answers it before the container on run.app URLs.
8. With `--smoke-checkout`, also posts `{"sku":"CELESTIAL_BANNER","locale":"en"}` to `/api/store/checkout` and expects 201 with a `redirectUrl`. That is one real sandbox API call. No money moves and nothing is granted; grants require the signed webhook.
9. Prints the next steps (below). Exits 1 if any smoke check failed.

Unauthenticated access is deliberate: Neon webhooks and browsers must reach the service. Per the script's comments, the meaningful routes are protected by bearer identity and raw-body HMAC verification, the catalog is public information, and checkout creation is rate limited per account. `max-instances=1` keeps the sandbox cheap; Firestore itself is multi-instance safe.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--project ID` | current `gcloud config` project | Exits if no project is set. |
| `--region REGION` | `asia-northeast3` | Cloud Run and Firestore region. |
| `--service NAME` | `neon-payment` | Cloud Run service name. |
| `--public-url URL` | `http://127.0.0.1:8642` | Origin the player's browser returns to after the hosted page (`successUrl`/`cancelUrl` base). Neon never fetches it, so a localhost value is valid. Not the API or webhook origin. |
| `--allowed-origins CSV` | `http://127.0.0.1:8642,http://localhost:8642,https://hakhyun-kim.github.io` | Browser origins allowed by CORS to call the API. The Pages origin is in the default so a redeploy without the flag keeps the shared link working; `--set-env-vars` replaces the whole list, so repeat it in full when it differs. |
| `--trust-geo-headers` | off | Set `TRUST_GEO_HEADERS=1` so the service reads the player's country from `cf-ipcountry` / `x-vercel-ip-country` / `x-appengine-country` / `x-geo-country`. Only correct behind a proxy that sets the header and strips the client's copy — see below. |
| `--env-file PATH` | `.env` | Where the two secret values are read from. |
| `--skip-secrets` | off | Reuse the existing Secret Manager versions. |
| `--smoke-only` | off | Skip APIs, Firestore, secrets, IAM and deploy. Run only the smoke checks against the existing service. |
| `--smoke-checkout` | off | Add the real checkout-create smoke check. |
| `--dry-run` | off | Print each command as `DRY-RUN>` instead of running it. Secrets are not read. The URL is a placeholder. |
| `--delete` | off | Delete the Cloud Run service. Both secrets are kept; the script prints the `gcloud secrets delete` commands. |
| `-h`, `--help` | | Print the header comment. An unknown flag exits with code 2. |

## What it prints at the end

- `Service URL` and `Webhook URL` (`<service-url>/api/webhooks/neon`).
- Step 1: in the Neon Console (sandbox), register the webhook URL for version 2 `purchase.completed` (and `refund.processed`), with the listener secret equal to the deployed `neon-webhook-secret`.
- Step 2: two edits in `index.html`: set `<meta name="neon-api-base" content="<service-url>">` and append `<service-url>` to the CSP `connect-src` list. Then `npm run serve` and open `http://127.0.0.1:8642/?lang=en&store=1`.
- Step 3: the log command (`gcloud run services logs read ...`) and the teardown command (`bash deploy/cloud-run.sh --delete --project ... --region ...`).

## Pointing a static client at the service

`src/app/neon-store.js` resolves the API origin in this order: the `?api=<origin>` query parameter, if it matches `^https?://host(:port)$` with no path; otherwise the `neon-api-base` meta in `index.html`; otherwise empty, which means the page's own origin. The CSP `connect-src` list in `index.html` is the enforcement. An origin that is not listed cannot be called, so any other `?api=` value is inert. Return URLs from the server carry the parameter back.

So a hosted static build needs the service origin in `connect-src`, and then either the meta edit or a link with `?api=<service-url>`. The committed `index.html` lists one deployed origin in `connect-src` and leaves the meta empty.

## Turning on real geolocation

Billing country decides tax jurisdiction, currency and payment methods, so the
service will not infer it from anything weaker than a location. Out of the box
it resolves an explicit market selection or the default market, and offers a
browser-region switch the player has to accept. Bare Cloud Run sees no
geography header, and a header nobody strips is caller-supplied input — with
`--trust-geo-headers` on an unproxied service, `curl -H 'cf-ipcountry: US'`
picks its own tax jurisdiction.

Real geolocation is therefore a deployment change, not a code change:

1. **Put a proxy that geolocates in front of the service.** Cloudflare (free
   tier) is the shortest path: add the domain, point a proxied (orange-cloud)
   `CNAME` at the Cloud Run URL, map the domain to the service
   (`gcloud beta run domain-mappings create --service neon-payment
   --domain <domain> --region asia-northeast3`), and enable *IP Geolocation*
   under the domain's Network settings so `cf-ipcountry` is added. A Google
   HTTPS load balancer with Cloud CDN is the same shape using
   `x-goog-...`/custom headers, and costs more.
2. **Close the direct path.** The header is only trustworthy if the proxy is
   the only way in. Restrict ingress to the load balancer
   (`--ingress internal-and-cloud-load-balancing`), or keep Cloud Run's URL
   private and publish only the proxied domain. Skipping this step leaves the
   forgeable path open next to the trusted one.
3. **Redeploy with the flag, and add the new origin to CORS.**
   ```bash
   bash deploy/cloud-run.sh --trust-geo-headers \
     --public-url https://<domain> \
     --allowed-origins "http://127.0.0.1:8642,http://localhost:8642,https://hakhyun-kim.github.io,https://<domain>"
   ```
   `--set-env-vars` replaces the whole environment, so pass the full origins
   list. Re-register the webhook URL in the Neon Console if the service origin
   changed.
4. **Verify both sides.** Through the proxy, a request from a Korean IP should
   report `KR` and one from a US IP `US`:
   ```bash
   curl -s 'https://<domain>/api/store/catalog?locale=en' | jq '.country, .currency, .suggestion'
   ```
   Then confirm the direct Cloud Run URL is closed, and that a forged header
   changes nothing where it is still reachable:
   ```bash
   curl -s -H 'cf-ipcountry: US' 'https://<domain>/api/store/catalog?locale=ko' | jq .country
   ```
   Cloudflare overwrites a client-supplied `cf-ipcountry`, so this must still
   answer with the geolocated country, not `US`.

Markets are limited to those in `server/catalog.mjs` (`KR`, `US`); a
geolocated country outside that table falls through to the default. Widening
the table means owning a price per market — Neon's pricing sheet and Global
Store are the alternative to hand-maintaining one.

## Sandbox only

The script hard-codes `NEON_ENVIRONMENT=sandbox` and `NEON_MOCK_CHECKOUT=0`. There is no production switch. `server/config.mjs` warns in sandbox mode that production webhooks (`isSandbox=false`) are ignored, and refuses to start when `NEON_API_KEY`, `NEON_WEBHOOK_SECRET`, or `PUBLIC_URL` is missing.

## Image

The root `Dockerfile` uses `node:22-slim`, runs `npm ci --omit=dev`, copies the checkout, sets `HOST=0.0.0.0`, `NODE_ENV=production`, `LOG_FORMAT=json`, `STORE_BACKEND=firestore`, and runs `node server/index.mjs`. `dist/` is committed, so the image does not run esbuild. `PUBLIC_URL` is set at deployment time.
