#!/usr/bin/env bash
echo "----------------------------------------"
echo "  Termux Zombie Process Cleaner"
echo "----------------------------------------"
echo "[+] Letar efter bakgrundsprocesser som blockerar portar..."

# Hitta processer som använder port 3000
PORT_PIDS=$(lsof -t -i:3000 2>/dev/null)
if [ -n "$PORT_PIDS" ]; then
    echo "[!] Hittade processer på port 3000: $PORT_PIDS. Dödar dem..."
    kill -9 $PORT_PIDS 2>/dev/null || true
fi

echo "[+] Dödar herrelösa node, tsx och vite processer..."
pkill -f "node dist/server.cjs" 2>/dev/null || true
pkill -f "tsx server.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "esbuild" 2>/dev/null || true

# Om Termux
if command -v termux-info >/dev/null 2>&1; then
    killall node 2>/dev/null || true
fi

echo "[+] Städning slutförd. Systemet är redo för en ren start."
echo "----------------------------------------"
