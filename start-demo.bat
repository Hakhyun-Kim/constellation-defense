@echo off
REM ====================================================================
REM  Constellation Defense - Neon checkout demo, one click (Windows)
REM
REM  Double-click this file. It will:
REM    1) on first run: create .env (mock mode), install deps, build
REM    2) start the payment server in this window
REM    3) open the guided tour in your browser a few seconds later
REM
REM  Close this window to stop the server. No credentials needed -
REM  the whole flow runs in mock mode (NEON_MOCK_CHECKOUT=1).
REM
REM  ASCII only on purpose: a .bat with non-ASCII text breaks under some
REM  console codepages. The Korean walkthrough lives in README.md.
REM  Delayed expansion (!VAR!) keeps the & in the URLs from being read
REM  as command separators.
REM ====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=8642"
set "NEON_MOCK_CHECKOUT=1"
set "NEON_ENVIRONMENT=sandbox"
set "STORE_BACKEND=json"
set "PUBLIC_URL=http://127.0.0.1:8642"
set "TOUR=http://127.0.0.1:%PORT%/?lang=en&demo=expert&tour=neon&mute"
set "TOUR_KO=http://127.0.0.1:%PORT%/?demo=%%EA%%B3%%A0%%EC%%88%%98&tour=neon&mute"

where npm >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js / npm not found. Install it from https://nodejs.org and retry.
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
echo   Server       : http://127.0.0.1:%PORT%/
echo   Guided tour  : !TOUR!
echo   Tour (Korean): !TOUR_KO!
echo   ----------------------------------------------------------------
echo   Closing this window stops the server.
echo.

REM Give the server a moment to bind, then open the tour in the default
REM browser as a separate process. The & inside the URL is safe because
REM it sits inside the double-quoted -Command argument.
start "" /b powershell -WindowStyle Hidden -NoProfile -Command "Start-Sleep 4; Start-Process '!TOUR!'"

REM Server runs in the foreground here so its logs stay visible.
call npm run serve

endlocal
