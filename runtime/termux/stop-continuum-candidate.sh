#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; STATE="$ROOT/.jaco/candidate"
for n in a2a sentinel core; do f="$STATE/$n.pid"; [[ -f "$f" ]] || continue; pid="$(cat "$f")"; cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"; if [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT/gateway" ]]; then kill "$pid" 2>/dev/null || true; fi; rm -f "$f"; done
printf '[CONTINUUM CANDIDATE] stopped candidate processes only\n'
