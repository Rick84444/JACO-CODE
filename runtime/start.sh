#!/usr/bin/env bash

# Quick start script for JACO AI Studio
if [ ! -d "node_modules" ] || [ ! -f "dist/server.cjs" ]; then
    echo "[+] First run detected. Running install.sh..."
    bash install.sh
else
    echo "[+] Starting JACO AI Studio server..."
    npm run start
fi
