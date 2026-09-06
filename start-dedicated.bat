@echo off
REM ====================================================================
REM  Constellation Defense - dedicated server demo, one click (Windows)
REM
REM  Double-click this file. It will:
REM    1) on first run: create .env (mock mode), install deps, build
REM    2) start the dedicated game server (ws://127.0.0.1:8643)
REM    3) start the web/static server in this window (http://127.0.0.1:8642)
REM    4) open the live viewer in your browser - the server plays a demo
REM       session immediately; the panel has a "Try the game" button.
REM
REM  Close this window to stop both servers. ASCII only on purpose.
REM ====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=8642"
set "NEON_MOCK_CHECKOUT=1"
set "NEON_ENVIRONMENT=sandbox"
set "STORE_BACKEND=json"
set "PUBLIC_URL=http://127.0.0.1:8642"
set "DEDICATED_PORT=8643"
set "DEDICATED_CONTROL_KEY=local-demo-key"
set "VIEW=http://127.0.0.1:%PORT%/?lang=en&dedicated=1&key=local-demo-key"

where npm >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js / npm not found. Install Node 22.9+ from https://nodejs.org and retry.
  pause
  exit /b 1
)

REM --env-file-if-exists exists from Node 22.9; older Node exits on the flag.
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]*100+v[1]<2209?1:0)" >nul 2>nul
if errorlevel 1 (
  for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
  echo [!] Node !NODE_VER! is too old. The server needs Node 22.9+ ^(--env-file-if-exists^).
  pause
  exit /b 1
)

if not exist ".env" (
  echo [i] No .env found - copying .env.example ^(mock mode^).
  copy /y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo [i] Installing dependencies... first run only, a few minutes.
  call npm install
  if errorlevel 1 ( echo [!] npm install failed & pause & exit /b 1 )
)

echo [i] Building the game bundle...
call npm run build
if errorlevel 1 ( echo [!] build failed & pause & exit /b 1 )

echo.
echo   ----------------------------------------------------------------
echo   Dedicated server : ws://127.0.0.1:%DEDICATED_PORT%/   (auth key: local-demo-key)
echo   Web client       : http://127.0.0.1:%PORT%/
echo   Live viewer      : !VIEW!
echo   ----------------------------------------------------------------
echo   Closing this window stops both servers.
echo.

REM The dedicated server runs minimized in its own window; closing this
REM window kills it via the taskkill below on Ctrl+C or window close.
start "cd-dedicated" /min cmd /c "node dedicated/server.mjs"

start "" /b powershell -WindowStyle Hidden -NoProfile -Command "Start-Sleep 4; Start-Process '!VIEW!'"

REM Web server runs in the foreground so its logs stay visible.
call npm run serve

REM When serve exits, stop the dedicated window as well.
taskkill /fi "WINDOWTITLE eq cd-dedicated*" /t /f >nul 2>nul
endlocal
