#!/bin/bash

# SecurVault - Cross-Platform Startup Script (Termux/Linux)

echo "--- SecurVault Unified Launcher ---"

# 1. Dependency Checks
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed."
    if [ -n "$TERMUX_VERSION" ]; then
        echo "Running in Termux. Attempting to install nodejs..."
        pkg install nodejs -y
    else
        echo "Please install Node.js (v18+) to continue."
        exit 1
    fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Warning: FFmpeg is not installed. Video streaming will be disabled."
    if [ -n "$TERMUX_VERSION" ]; then
        echo "Running in Termux. Attempting to install ffmpeg..."
        pkg install ffmpeg -y
    else
        echo "Please install FFmpeg to enable video features."
    fi
fi

# 2. Check for node_modules
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo "Missing dependencies. Running install-all..."
    npm run install-all
fi

# 3. Start SecurVault
# DYNAMIC IP DISCOVERY (LINUX/TERMUX)
IP=$(hostname -I | awk '{print $1}')
if [ -z "$IP" ]; then IP="localhost"; fi

echo "Launching SecurVault Desktop & Server..."
echo "---------------------------------------------------------"
echo "🌐 ACCESS YOUR VAULT AT:"
echo "   LOCAL (HERE): http://localhost:5173"
echo "   NETWORK (UI): http://$IP:5173"
echo "   BACKEND (API): http://$IP:5001"
echo "---------------------------------------------------------"
echo ""
echo "TIP: Enter the NETWORK (UI) link in your phone or laptop"
echo "     browser while on the same Wi-Fi."
echo ""
npm start
