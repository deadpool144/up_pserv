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
echo "Launching SecurVault Desktop & Server..."
echo "---------------------------------------------------------"
echo "🌐 ACCESS YOUR VAULT AT:"
echo "   FRONTEND (UI): http://localhost:5173"
echo "   BACKEND (API): http://localhost:5001"
echo "---------------------------------------------------------"
echo ""
echo "TIP: Use your device IP (e.g. 192.168.1.x using 'ifconfig')"
echo "     to access from other phones or laptops on same Wi-Fi."
echo ""
npm start
