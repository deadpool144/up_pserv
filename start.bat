@echo off
setlocal enabledelayedexpansion

echo.
echo ---------------------------------------------------------
echo   SECURVAULT - UNIFIED STARTUP
echo ---------------------------------------------------------
echo.

REM 1. Dependencies Check
if not exist node_modules (
    echo [System] Installing root dependencies...
    call npm install
)

REM 2. IP Discovery
set MYIP=localhost
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr "IPv4 Address"') do (
    set TMP_IP=%%i
    set MYIP=!TMP_IP: =!
)

echo.
echo [System] Launching Servers...
echo ---------------------------------------------------------
echo UI (LOCAL):   http://localhost:5173
echo UI (NETWORK): http://!MYIP!:5173
echo API:          http://!MYIP!:5001
echo ---------------------------------------------------------
echo.

npm run dev
pause
