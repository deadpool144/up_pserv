@echo off
echo.
echo =========================================================
echo 🚀 STARTING SECURVAULT UNIFIED ECOSYSTEM
echo =========================================================
echo.

if not exist node_modules (
    echo [System] Installing root dependencies (concurrently)...
    call npm install
)

if not exist backend\node_modules (
    echo [System] Installing backend dependencies...
    call npm install --prefix backend
)

if not exist frontend\node_modules (
    echo [System] Installing frontend dependencies...
    call npm install --prefix frontend
)

echo.
echo [System] Launching Servers...
echo.
echo ---------------------------------------------------------
echo 🌐 ACCESS YOUR VAULT AT:
echo    FRONTEND (UI): http://localhost:5173
echo    BACKEND (API): http://localhost:5001
echo ---------------------------------------------------------
echo.
echo TIP: If on Wi-Fi, use your device IP (e.g. 192.168.1.x) 
echo      to access from other phones or laptops.
echo.

npm run dev
pause
