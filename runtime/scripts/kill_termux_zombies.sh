#!/usr/bin/env bash
echo "----------------------------------------"
echo "  Termux Zombie Process Cleaner"
echo "----------------------------------------"
echo "[+] Looking for background processes blocking ports..."

# Find processes using port 3000
PORT_PIDS=$(lsof -t -i:3000 2>/dev/null)
if [ -n "$PORT_PIDS" ]; then
    echo "[!] Found processes on port 3000: $PORT_PIDS. Killing them..."
    kill -9 $PORT_PIDS 2>/dev/null || true
fi

echo "[+] Killing stray node, tsx and vite processes..."
pkill -f "node dist/server.cjs" 2>/dev/null || true
pkill -f "tsx server.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "esbuild" 2>/dev/null || true

# If Termux
if command -v termux-info >/dev/null 2>&1; then
    killall node 2>/dev/null || true
fi

echo "[+] Cleanup complete. The system is ready for a clean start."
echo "----------------------------------------"
