#!/data/data/com.termux/files/usr/bin/bash
# Runs Nova on this phone as a device of the JACO hub (runtime src/server/connected/deviceAccess.mjs).
# Unlike termux/bootstrap-jaco-autonomous.sh this starts no runtime, SEER or Workplace here: the phone
# only runs the missions the hub routes to it, so it never competes with the hub's own Nova.
#
#   bash tools/termux-device.sh join <hub-url> <pairing-code>   first time (code from the hub's IDE, Enheter)
#   bash tools/termux-device.sh start | stop | status | log
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PIDFILE="$ROOT/agents/.agent-state/device-nova.pid"
LOG="$ROOT/agents/.agent-state/device-nova.log"
mkdir -p "$ROOT/agents/.agent-state"

say(){ printf '[JACO device] %s\n' "$*"; }
die(){ printf '[JACO device] FAIL %s\n' "$*" >&2; exit 1; }
env_has(){ grep -qE "^$1=." .env 2>/dev/null; }
env_set(){ # KEY VALUE: replace or append one line, keep the rest of .env
  node -e "const fs=require('fs');const [k,v]=process.argv.slice(1);let s=fs.existsSync('.env')?fs.readFileSync('.env','utf8'):'';const re=new RegExp('^'+k+'=.*$','m');s=re.test(s)?s.replace(re,k+'='+v):s.replace(/\s*$/,'')+(s.trim()?'\n':'')+k+'='+v+'\n';fs.writeFileSync('.env',s,{mode:0o600})" "$1" "$2"
}
running(){ [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

stop_standalone(){
  # The earlier standalone setup (termux/services, termux-services/runit) ran its own Nova and Workplace
  # here, which took work in parallel with the hub. The phone's runtime (jaco-core), browser bridge and
  # local Ollama keep running: they are the tools this Nova uses on the phone.
  if command -v sv >/dev/null 2>&1 && [[ -n "${PREFIX:-}" ]]; then
    for s in jaco-nova jaco-workplace jaco-sentinel; do
      if [[ -d "$PREFIX/var/service/$s" ]]; then sv down "$s" 2>/dev/null || true; touch "$PREFIX/var/service/$s/down"; say "standalone service $s stopped and disabled"; fi
    done
  fi
  pkill -f 'agents/hands-off-agent.mjs' 2>/dev/null || true
  pkill -f 'workplace-server.mjs' 2>/dev/null || true
}

# The Termux stack keeps its providers and tokens in ~/.config/jaco/runtime.env (termux/services/*/run).
# Nova here uses the same file, so Ollama Cloud, Hugging Face and the phone runtime's token work without
# copying keys. Device settings are applied after it and win.
load_stack_env(){
  local f="${JACO_RUNTIME_ENV:-$HOME/.config/jaco/runtime.env}"
  # shellcheck source=/dev/null
  if [[ -f "$f" ]]; then set -a; . "$f"; set +a; say "using the stack's settings from $f"; fi
  [[ -n "${JACO_GATEWAY_TOKEN:-}" && -z "${GATEWAY_TOKEN:-}" ]] && export GATEWAY_TOKEN="$JACO_GATEWAY_TOKEN"
  export NOVA_BRAIN_MODE=direct JACO_WORKPLACE_REQUIRED=0
  unset JACO_HUB_URL JACO_DEVICE_KEY JACO_NOVA_EXECUTOR   # these come from this checkout's .env
}
has_key(){ [[ -n "${!1:-}" ]] || env_has "$1"; }

preflight(){
  command -v node >/dev/null 2>&1 || die 'Node.js missing: pkg install nodejs-lts git'
  [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]] || die "Node 22+ required, found $(node -v): pkg upgrade nodejs-lts"
  if [[ ! -d node_modules/dotenv ]]; then
    say 'installing dependencies (no browser download)'
    PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund
  fi
}

start(){
  env_has JACO_HUB_URL && env_has JACO_DEVICE_KEY && env_has JACO_NOVA_EXECUTOR || die 'not joined yet: bash tools/termux-device.sh join <hub-url> <code>'
  load_stack_env
  # Planner order: Ollama Cloud (free plan), Groq, OpenRouter, then paid ones (Hugging Face, DeepSeek).
  has_key OLLAMA_API_KEY || has_key GROQ_API_KEY || has_key OPENROUTER_API_KEY || has_key HUGGINGFACE_TOKEN || has_key HF_TOKEN || has_key DEEPSEEK_API_KEY \
    || die 'no planner key found in ~/.config/jaco/runtime.env or .env: add OLLAMA_API_KEY (or HUGGINGFACE_TOKEN), then start again'
  for k in OLLAMA_API_KEY HUGGINGFACE_TOKEN HF_TOKEN GROQ_API_KEY DEEPSEEK_API_KEY; do has_key "$k" && say "planner key present: $k"; done
  running && { say "Nova already running (pid $(cat "$PIDFILE"))"; return; }
  stop_standalone
  termux-wake-lock 2>/dev/null || true
  nohup node agents/hands-off-agent.mjs >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 8
  running || { tail -n 20 "$LOG"; die 'Nova exited; see the log above'; }
  say "Nova running as $(grep -E '^JACO_NOVA_EXECUTOR=' .env | cut -d= -f2) (pid $(cat "$PIDFILE")); log: bash tools/termux-device.sh log"
}

case "${1:-}" in
  join)
    [[ $# -eq 3 ]] || die 'usage: bash tools/termux-device.sh join <hub-url> <pairing-code>'
    preflight
    node tools/join-hub.mjs "$2" "$3"
    # A device plans with its own model keys and has no local SEER or Workplace (the hub's are not
    # reachable from the phone); missions and receipts still go to the hub.
    env_set NOVA_BRAIN_MODE direct
    env_set JACO_WORKPLACE_REQUIRED 0
    start
    ;;
  start) preflight; start ;;
  stop)
    if running; then kill "$(cat "$PIDFILE")"; say 'Nova stopped'; else say 'Nova was not running'; fi
    rm -f "$PIDFILE"; termux-wake-unlock 2>/dev/null || true
    ;;
  status)
    if running; then say "running (pid $(cat "$PIDFILE"))"; else say 'not running'; fi
    grep -E '^(JACO_HUB_URL|JACO_NOVA_EXECUTOR)=' .env 2>/dev/null || say 'not joined'
    ;;
  log) tail -n 40 "$LOG" ;;
  *) die 'usage: bash tools/termux-device.sh join <hub-url> <code> | start | stop | status | log' ;;
esac
