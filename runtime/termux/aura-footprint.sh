#!/data/data/com.termux/files/usr/bin/bash
# Read-only measurement of JACO-owned processes; prints no raw cmdlines or secrets.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME="$ROOT/runtime"
PROC_ROOT="${JACO_AURA_PROC_ROOT:-/proc}"
if [[ "$PROC_ROOT" != /proc && "${JACO_TEST_MODE:-0}" != 1 ]]; then
  echo "AURA_FOOTPRINT_SYNTHETIC_PROC_REQUIRES_TEST_MODE" >&2
  exit 42
fi
printf 'AURA_FOOTPRINT %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'RSS=resident KiB (includes shared pages; not private/PSS), no kernel OOM proof\n'
printf '%-8s %-15s %12s\n' PID SERVICE RSS_KiB
count=0
sum=0
for dir in "$PROC_ROOT"/[0-9]*; do
  [[ -r "$dir/cmdline" && -r "$dir/status" ]] || continue
  pid="${dir##*/}"
  cwd="$(readlink "$dir/cwd" 2>/dev/null || true)"
  # Process command is never printed because it may contain arguments/secrets.
  cmd="$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null || true)"
  case "$cmd" in
    *gateway/src/workplace/workplace-server.mjs*) service=Workplace ;;
    *gateway/src/seer-start.mjs*|*gateway/src/seer.mjs*) service=SEER ;;
    *agents/hands-off-agent.mjs*|*agents/run-desktop-agentos.mjs*) service=AuraExecutor ;;
    *litert-lm*serve*|*litert_lm_cli*openai_handler*) service=LiteRT ;;
    *ollama*serve*) service=Ollama ;;
    *agents/nova-bridge.mjs*) service=NovaBridge ;;
    *agents/cdp-bridge.mjs*) service=CDPBridge ;;
    *src/sentinel.mjs*) service=Sentinel ;;
    *mcp-server*|*jaco-mcp-launch.mjs*|*jaco-editor.mjs*|*@modelcontextprotocol/*) service=MCP ;;
    *server.ts*|*dist/server.cjs*)
      [[ "$cwd" == "$RUNTIME" ]] || continue
      service=Core
      ;;
    *) continue ;;
  esac
  # Exclude unrelated lookalikes outside the canonical checkout, except
  # LiteRT/Ollama processes launched by Termux which may use other cwds.
  case "$service" in
    LiteRT|Ollama) : ;;
    *) [[ "$cwd" == "$ROOT" || "$cwd" == "$RUNTIME" || "$cwd" == "$ROOT/gateway" ]] || continue ;;
  esac
  rss="$(awk '/^VmRSS:/ {print $2; exit}' "$dir/status" 2>/dev/null || true)"
  [[ "$rss" =~ ^[0-9]+$ ]] || rss=0
  printf '%-8s %-15s %12s\n' "$pid" "$service" "$rss"
  count=$((count+1))
  sum=$((sum+rss))
done
printf 'PROCESS_COUNT=%s RSS_SUM_KiB=%s\n' "$count" "$sum"
if [[ "$count" == 0 ]]; then
  echo 'No matching visible JACO processes. Termux /proc restrictions may hide process details.'
fi
