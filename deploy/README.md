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
3. Creates the secrets `neon-api-key` and `neon-webhook-secret` if missing, then adds a new version of each from the env file or the prompt. `--skip-secrets` leaves the existing versions unchanged.
4. Grants the compute default service account `roles/secretmanager.secretAccessor` on both secrets, plus `roles/datastore.user` and `roles/cloudbuild.builds.builder` on the project. The last binding is needed because projects created since 2024 no longer give that account the Cloud Build roles, so a `--source` deploy fails reading its own upload.
5. Runs `gcloud run deploy --source .` with `--allow-unauthenticated`, `--min-instances 0 --max-instances 1 --memory 512Mi`. Environment: `NEON_MOCK_CHECKOUT=0`, `NEON_ENVIRONMENT=sandbox`, `STORE_BACKEND=firestore`, `LOG_FORMAT=json`, `GOOGLE_CLOUD_PROJECT`, `PUBLIC_URL`, `ALLOWED_ORIGINS`. Secrets are mounted as `NEON_API_KEY` and `NEON_WEBHOOK_SECRET` (`:latest`).
6. Smoke checks against the service URL: `GET /api/store/catalog?locale=en` expects 200 (liveness), `GET /readyz` expects 200 (Firestore reachable), and a `POST /api/webhooks/neon` with a forged `x-neon-digest` expects 403, which proves the secret is loaded. `/healthz` is not probed because Google's frontend answers it before the container on run.app URLs.
7. With `--smoke-checkout`, also posts `{"sku":"CELESTIAL_BANNER","locale":"en"}` to `/api/store/checkout` and expects 201 with a `redirectUrl`. That is one real sandbox API call. No money moves and nothing is granted; grants require the signed webhook.
8. Prints the next steps (below). Exits 1 if any smoke check failed.

Unauthenticated access is deliberate: Neon webhooks and browsers must reach the service. Per the script's comments, the meaningful routes are protected by bearer identity and raw-body HMAC verification, the catalog is public information, and checkout creation is rate limited per account. `max-instances=1` keeps the sandbox cheap; Firestore itself is multi-instance safe.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--project ID` | current `gcloud config` project | Exits if no project is set. |
| `--region REGION` | `asia-northeast3` | Cloud Run and Firestore region. |
| `--service NAME` | `neon-payment` | Cloud Run service name. |
| `--public-url URL` | `http://127.0.0.1:8642` | Origin the player's browser returns to after the hosted page (`successUrl`/`cancelUrl` base). Neon never fetches it, so a localhost value is valid. Not the API or webhook origin. |
| `--allowed-origins CSV` | `http://127.0.0.1:8642,http://localhost:8642` | Browser origins allowed by CORS to call the API. |
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

## Sandbox only

The script hard-codes `NEON_ENVIRONMENT=sandbox` and `NEON_MOCK_CHECKOUT=0`. There is no production switch. `server/config.mjs` warns in sandbox mode that production webhooks (`isSandbox=false`) are ignored, and refuses to start when `NEON_API_KEY`, `NEON_WEBHOOK_SECRET`, or `PUBLIC_URL` is missing.

## Image

The root `Dockerfile` uses `node:22-slim`, runs `npm ci --omit=dev`, copies the checkout, sets `HOST=0.0.0.0`, `NODE_ENV=production`, `LOG_FORMAT=json`, `STORE_BACKEND=firestore`, and runs `node server/index.mjs`. `dist/` is committed, so the image does not run esbuild. `PUBLIC_URL` is set at deployment time.
