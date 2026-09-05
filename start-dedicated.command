#!/bin/bash
# ====================================================================
#  Constellation Defense - dedicated server demo, one click (macOS/Linux)
#
#  Double-click in Finder or run: ./start-dedicated.command
#  It will:
#    1) on first run: create .env (mock mode), install deps, build
#    2) start the dedicated game server (ws://127.0.0.1:8643)
#    3) start the web/static server in this terminal (http://127.0.0.1:8642)
#    4) open the live viewer - the server plays a demo session
#       immediately; the panel has a "Try the game" button.
#
#  Ctrl+C (or closing the terminal) stops both servers.
# ====================================================================
set -u
cd "$(dirname "$0")"

PORT=8642
export NEON_MOCK_CHECKOUT=1
export NEON_ENVIRONMENT=sandbox
export STORE_BACKEND=json
export PUBLIC_URL="http://127.0.0.1:${PORT}"
export DEDICATED_PORT=8643
export DEDICATED_CONTROL_KEY=local-demo-key
VIEW="http://127.0.0.1:${PORT}/?lang=en&dedicated=1&key=local-demo-key"

if ! command -v npm >/dev/null 2>&1; then
  echo "[!] Node.js / npm not found. Install Node 22.9+ from https://nodejs.org and retry."
  read -r -p "Press Enter to close." _
  exit 1
fi

NODE_OK=$(node -p 'const [maj, min] = process.versions.node.split(".").map(Number); maj > 22 || (maj === 22 && min >= 9) ? "yes" : "no"' 2>/dev/null || echo no)
if [ "${NODE_OK}" != "yes" ]; then
  echo "[!] Node $(node -v 2>/dev/null) is too old. The servers need Node 22.9+."
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
echo "  Dedicated server : ws://127.0.0.1:${DEDICATED_PORT}/   (auth key: local-demo-key)"
echo "  Web client       : http://127.0.0.1:${PORT}/"
echo "  Live viewer      : ${VIEW}"
echo "  ----------------------------------------------------------------"
echo "  Ctrl+C stops both servers."
echo

node dedicated/server.mjs &
DEDICATED_PID=$!
trap 'kill "${DEDICATED_PID}" 2>/dev/null' EXIT INT TERM

(
  sleep 4
  if command -v open >/dev/null 2>&1; then open "${VIEW}"; else xdg-open "${VIEW}" >/dev/null 2>&1 || true; fi
) &

# Web server runs in the foreground so its logs stay visible.
npm run serve
