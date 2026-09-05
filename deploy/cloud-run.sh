#!/usr/bin/env bash
# ====================================================================
#  Deploy the payment service (server/index.mjs, root Dockerfile) to
#  Cloud Run, with the Neon sandbox keys in Secret Manager.
#
#  This is hand-off option 1: keys stay server-side, the webhook target
#  is stable, and a reviewer's local client completes real sandbox
#  purchases without ever holding a credential.
#
#    bash deploy/cloud-run.sh                  # deploy/update (idempotent)
#    bash deploy/cloud-run.sh --dry-run        # print what would run
#    bash deploy/cloud-run.sh --smoke-checkout # + one real checkout create
#    bash deploy/cloud-run.sh --delete         # tear the service down
#
#  Flags:
#    --project ID          default: current `gcloud config` project
#    --region REGION       default: asia-northeast3 (Seoul)
#    --service NAME        default: neon-payment
#    --public-url URL      default: http://127.0.0.1:8642
#                          The origin the PLAYER'S BROWSER returns to after
#                          the hosted page (successUrl/cancelUrl base). Neon
#                          never fetches it, so a reviewer's own localhost
#                          is a valid value. Not the API/webhook origin.
#    --allowed-origins CSV default: http://127.0.0.1:8642,http://localhost:8642
#                          Browser origins allowed by CORS to call this API.
#    --env-file PATH       default: .env — where NEON_API_KEY and
#                          NEON_WEBHOOK_SECRET are read from (never echoed);
#                          missing values are prompted for with hidden input.
#    --skip-secrets        reuse existing Secret Manager versions unchanged
#
#  Runs in Git Bash (Windows), macOS, Linux, or Cloud Shell. Requires the
#  gcloud CLI, an authenticated account, and a project with billing.
#  The upload honors .gitignore, so .env and .data never leave the machine.
# ====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=""
REGION="asia-northeast3"
SERVICE="neon-payment"
PUBLIC_URL="http://127.0.0.1:8642"
ALLOWED_ORIGINS="http://127.0.0.1:8642,http://localhost:8642"
ENV_FILE=".env"
DRY_RUN=0
SKIP_SECRETS=0
SMOKE_CHECKOUT=0
DELETE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --allowed-origins) ALLOWED_ORIGINS="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --skip-secrets) SKIP_SECRETS=1; shift ;;
    --smoke-checkout) SMOKE_CHECKOUT=1; shift ;;
    --delete) DELETE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "[!] Unknown flag: $1 (see --help)"; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = 1 ]; then echo "DRY-RUN> $*"; else "$@"; fi
}

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[!] gcloud CLI not found. Install the Google Cloud SDK, or run this from Cloud Shell."
  exit 1
fi
if [ ! -f Dockerfile ] || [ ! -f server/index.mjs ]; then
  echo "[!] Run from the constellation-defense checkout (Dockerfile + server/ expected)."
  exit 1
fi

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "[!] No project. Pass --project ID or run: gcloud config set project ID"
  exit 1
fi
GC=(gcloud --project "$PROJECT")

if [ "$DELETE" = 1 ]; then
  run "${GC[@]}" run services delete "$SERVICE" --region "$REGION" --quiet
  echo "[i] Service deleted. Secrets neon-api-key / neon-webhook-secret were kept;"
  echo "    remove them with: gcloud secrets delete neon-api-key (and neon-webhook-secret)"
  exit 0
fi

echo "[i] Project: $PROJECT · Region: $REGION · Service: $SERVICE"
echo "[i] PUBLIC_URL (player return origin): $PUBLIC_URL"
echo "[i] ALLOWED_ORIGINS (CORS):            $ALLOWED_ORIGINS"

# --- APIs (idempotent) ------------------------------------------------------
run "${GC[@]}" services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com

# --- Firestore (Native mode, once per project) ------------------------------
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY-RUN> gcloud firestore databases describe || create --location=$REGION"
elif ! "${GC[@]}" firestore databases describe --database='(default)' >/dev/null 2>&1; then
  run "${GC[@]}" firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
else
  echo "[i] Firestore database already exists."
fi

# --- Secrets ----------------------------------------------------------------
# Values come from $ENV_FILE or a hidden prompt; they are piped straight into
# Secret Manager and never echoed or written anywhere else.
read_env_value() { # name -> stdout (empty if absent)
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -1
}
put_secret() { # secret-name value
  if ! "${GC[@]}" secrets describe "$1" >/dev/null 2>&1; then
    run "${GC[@]}" secrets create "$1" --replication-policy=automatic
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY-RUN> printf '***' | gcloud secrets versions add $1 --data-file=-"
  else
    printf %s "$2" | "${GC[@]}" secrets versions add "$1" --data-file=- >/dev/null
    echo "[i] Secret $1: new version added."
  fi
}
if [ "$SKIP_SECRETS" = 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    put_secret neon-api-key "(not read in dry-run)"
    put_secret neon-webhook-secret "(not read in dry-run)"
  else
    API_KEY="$(read_env_value NEON_API_KEY)"
    WEBHOOK_SECRET="$(read_env_value NEON_WEBHOOK_SECRET)"
    if [ -z "$API_KEY" ]; then read -r -s -p "NEON_API_KEY (hidden): " API_KEY; echo; fi
    if [ -z "$WEBHOOK_SECRET" ]; then read -r -s -p "NEON_WEBHOOK_SECRET (hidden): " WEBHOOK_SECRET; echo; fi
    if [ -z "$API_KEY" ] || [ -z "$WEBHOOK_SECRET" ]; then
      echo "[!] Both NEON_API_KEY and NEON_WEBHOOK_SECRET are required (hosted mode refuses to boot without them)."
      exit 1
    fi
    put_secret neon-api-key "$API_KEY"
    put_secret neon-webhook-secret "$WEBHOOK_SECRET"
    unset API_KEY WEBHOOK_SECRET
  fi
fi

# --- Runtime service account: read secrets + use Firestore ------------------
if [ "$DRY_RUN" = 1 ]; then
  SA="PROJECT_NUMBER-compute@developer.gserviceaccount.com"
  echo "DRY-RUN> grant roles/secretmanager.secretAccessor on both secrets + roles/datastore.user to $SA"
else
  PROJECT_NUMBER="$("${GC[@]}" projects describe "$PROJECT" --format='value(projectNumber)')"
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  for secret in neon-api-key neon-webhook-secret; do
    "${GC[@]}" secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
  done
  "${GC[@]}" projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role=roles/datastore.user >/dev/null
  echo "[i] Runtime service account $SA can read the secrets and Firestore."
fi

# --- Deploy -----------------------------------------------------------------
# --allow-unauthenticated is deliberate: Neon webhooks and reviewer browsers
# must reach it. The meaningful routes are protected by bearer identity and
# raw-body HMAC verification; the catalog is public information; checkout
# creation is rate limited per account. max-instances=1 keeps the sandbox
# demo cheap and simple (Firestore itself is multi-instance safe).
# ALLOWED_ORIGINS contains commas, so the env-var list uses gcloud's
# alternate-delimiter syntax (^##^) instead of the comma default.
run "${GC[@]}" run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --memory 512Mi \
  --set-env-vars "^##^NEON_MOCK_CHECKOUT=0##NEON_ENVIRONMENT=sandbox##STORE_BACKEND=firestore##LOG_FORMAT=json##GOOGLE_CLOUD_PROJECT=$PROJECT##PUBLIC_URL=$PUBLIC_URL##ALLOWED_ORIGINS=$ALLOWED_ORIGINS" \
  --set-secrets "NEON_API_KEY=neon-api-key:latest,NEON_WEBHOOK_SECRET=neon-webhook-secret:latest"

if [ "$DRY_RUN" = 1 ]; then
  URL="https://$SERVICE-DRYRUN-$REGION.run.app"
else
  URL="$("${GC[@]}" run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
fi

# --- Smoke ------------------------------------------------------------------
smoke() { # path expected-status label
  local status
  status=$(curl -s -o /tmp/smoke-body -w '%{http_code}' "$URL$1" "${@:4}") || status=000
  if [ "$status" = "$2" ]; then
    echo "[✓] $3 ($1 → $status)"
  else
    echo "[!] $3 FAILED: $1 → $status (expected $2)"
    cat /tmp/smoke-body 2>/dev/null | head -3
    SMOKE_FAILED=1
  fi
}
SMOKE_FAILED=0
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY-RUN> smoke: GET /healthz=200 · GET /readyz=200 (Firestore) · forged webhook=403"
else
  smoke /healthz 200 "liveness"
  smoke /readyz 200 "readiness (Firestore reachable)"
  # A forged webhook must be loudly rejected — proves the secret is loaded.
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/webhooks/neon" \
    -H 'content-type: application/json' -H 'x-neon-digest: forged' -d '{}')
  if [ "$status" = 403 ]; then echo "[✓] forged webhook rejected (403)"; else echo "[!] forged webhook: got $status, expected 403"; SMOKE_FAILED=1; fi
  if [ "$SMOKE_CHECKOUT" = 1 ]; then
    # One real sandbox checkout create (a Neon API call; no money moves and
    # nothing is granted — grants require the signed webhook).
    status=$(curl -s -o /tmp/smoke-body -w '%{http_code}' -X POST "$URL/api/store/checkout" \
      -H 'content-type: application/json' -d '{"sku":"CELESTIAL_BANNER","locale":"en"}')
    if [ "$status" = 201 ] && grep -q redirectUrl /tmp/smoke-body; then
      echo "[✓] real sandbox checkout created (201 + redirectUrl) — key works end to end"
    else
      echo "[!] checkout smoke: got $status (expected 201) — check NEON_API_KEY / service logs"
      head -3 /tmp/smoke-body 2>/dev/null
      SMOKE_FAILED=1
    fi
  fi
fi

# --- Next steps -------------------------------------------------------------
cat <<EOF

  ----------------------------------------------------------------
  Service URL : $URL
  Webhook URL : $URL/api/webhooks/neon
  ----------------------------------------------------------------
  1) Neon Console (sandbox) → register the webhook URL above for
     version 2 'purchase.completed' (+ 'refund.processed'), and make
     sure the listener secret equals the deployed neon-webhook-secret.

  2) Point a local client at this API (two edits in index.html):
       <meta name="neon-api-base" content="$URL">
     and append to the CSP connect-src list:
       $URL
     Then: npm run serve → http://127.0.0.1:8642/?lang=en&store=1

  3) Logs:    gcloud run services logs read $SERVICE --region $REGION --project $PROJECT
     Teardown: bash deploy/cloud-run.sh --delete --project $PROJECT --region $REGION
EOF
[ "$SMOKE_FAILED" = 0 ] || { echo "[!] One or more smoke checks failed — see above."; exit 1; }
