#!/bin/bash
# ====================================================================
#  Constellation Defense - Neon checkout demo, one click (macOS/Linux)
#
#  Double-click this file in Finder (or run: ./start-demo.command).
#  It will:
#    1) on first run: create .env (mock mode), install deps, build
#    2) start the payment server in this terminal
#    3) open the checkout inspector in your browser a few seconds later
#
#  Close the terminal (or press Ctrl+C) to stop the server.
#  No credentials needed - the whole flow runs in mock mode.
#
#  If Finder refuses to open a downloaded copy ("unidentified
#  developer"), right-click the file and choose Open once, or run
#  `bash start-demo.command` from a terminal. Cloning with git avoids
#  the quarantine flag entirely.
# ====================================================================
set -u
cd "$(dirname "$0")"

PORT=8642
export NEON_MOCK_CHECKOUT=1
export NEON_ENVIRONMENT=sandbox
export STORE_BACKEND=json
export PUBLIC_URL="http://127.0.0.1:${PORT}"
TOUR="http://127.0.0.1:${PORT}/?lang=en&demo=expert&tour=neon&mute"
TOUR_KO="http://127.0.0.1:${PORT}/?demo=%EA%B3%A0%EC%88%98&tour=neon&mute"

if ! command -v npm >/dev/null 2>&1; then
  echo "[!] Node.js / npm not found. Install Node 22.9+ from https://nodejs.org and retry."
  read -r -p "Press Enter to close." _
  exit 1
fi

# --env-file-if-exists exists from Node 22.9; older Node exits on the flag.
NODE_OK=$(node -p 'const [maj, min] = process.versions.node.split(".").map(Number); maj > 22 || (maj === 22 && min >= 9) ? "yes" : "no"' 2>/dev/null || echo no)
if [ "${NODE_OK}" != "yes" ]; then
  echo "[!] Node $(node -v 2>/dev/null) is too old. The server needs Node 22.9+ (--env-file-if-exists)."
  read -r -p "Press Enter to close." _
  exit 1
fi

if [ ! -f .env ]; then
  echo "[i] No .env found - copying .env.example (mock mode)."
  cp .env.example .env
fi

if [ ! -d node_modules ]; then
  echo "[i] Installing dependencies... first run only, a few minutes."
  npm install || { echo "[!] npm install failed"; read -r -p "Press Enter to close." _; exit 1; }
fi

echo "[i] Building the game bundle..."
npm run build || { echo "[!] build failed"; read -r -p "Press Enter to close." _; exit 1; }

echo
echo "  ----------------------------------------------------------------"
echo "  Server            : http://127.0.0.1:${PORT}/"
echo "  Inspector         : ${TOUR}"
echo "  Inspector (Korean): ${TOUR_KO}"
echo "  ----------------------------------------------------------------"
echo "  Ctrl+C (or closing this terminal) stops the server."
echo

# Give the server a moment to bind, then open the inspector in the
# default browser. `open` exists on macOS; fall back to xdg-open.
(
  sleep 4
  if command -v open >/dev/null 2>&1; then open "${TOUR}"; else xdg-open "${TOUR}" >/dev/null 2>&1 || true; fi
) &

# Server runs in the foreground here so its logs stay visible.
npm run serve
