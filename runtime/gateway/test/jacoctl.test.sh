#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup(){
  for pidfile in "$TMP"/state/*.pid; do
    [[ -f "$pidfile" ]] || continue
    pid="$(cat "$pidfile")"
    [[ "$pid" == 123 ]] || kill "$pid" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT
# Failures in the integration fixture must name the exact failing assertion
# instead of leaving a bare exit code after successful activation.
trap 'rc=$?; case $- in *e*) printf "JACOCTL_TEST_FAILED line=%s command=%s exit=%s\\n" "$LINENO" "$BASH_COMMAND" "$rc" >&2;; esac' ERR
mkdir -p "$TMP/bin" \
  "$TMP/prefix/var/service/jaco-sentinel/supervise" \
  "$TMP/prefix/var/service/jaco-core/supervise" \
  "$TMP/prefix/var/service/jaco-workplace/supervise" \
  "$TMP/prefix/var/service/jaco-nova/supervise" \
  "$TMP/prefix/var/service/jaco-ollama/supervise" \
  "$TMP/prefix/var/service/jaco-nova-bridge/supervise" \
  "$TMP/prefix/var/service/jaco-cdp/supervise" \
  "$TMP/state" \
  "$TMP/home/llama.cpp/build/bin" \
  "$TMP/home/models"
touch "$TMP/prefix/var/service/jaco-sentinel/supervise/ok" \
  "$TMP/prefix/var/service/jaco-core/supervise/ok" \
  "$TMP/prefix/var/service/jaco-workplace/supervise/ok" \
  "$TMP/prefix/var/service/jaco-nova/supervise/ok" \
  "$TMP/prefix/var/service/jaco-ollama/supervise/ok" \
  "$TMP/prefix/var/service/jaco-nova-bridge/supervise/ok" \
  "$TMP/prefix/var/service/jaco-cdp/supervise/ok"
cat > "$TMP/bin/sv" <<'SH'
#!/usr/bin/env bash
set -eu
cmd="$1"; path="$2"; name="$(basename "$path")"; marker="$STUB_STATE/$name"
pidfile="$marker.pid"
case "$cmd" in
 up)
   : > "$marker"
   if [[ -s "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then exit 0; fi
   cwd=''; entry=''
   case "$name" in
     jaco-sentinel) cwd="$JACO_ROOT/gateway"; entry="src/sentinel.mjs" ;;
     jaco-core) cwd="$JACO_ROOT"; entry="server.ts" ;;
     jaco-workplace) cwd="$(cd "$JACO_ROOT/.." && pwd)"; entry="gateway/src/workplace/workplace-server.mjs" ;;
   esac
   if [[ -n "$entry" ]]; then
     (cd "$cwd" && exec -a "node $entry" sleep 300) >/dev/null 2>&1 &
     echo $! > "$pidfile"
   else
     echo 123 > "$pidfile"
   fi
   ;;
 down)
   if [[ "\${STUB_REFUSE_DOWN_SERVICE:-}" != "$name" ]]; then
     rm -f "$marker"
     if [[ -s "$pidfile" ]]; then
       pid="$(cat "$pidfile")"
       [[ "$pid" == 123 ]] || kill "$pid" 2>/dev/null || true
       rm -f "$pidfile"
     fi
   fi
   ;;
 status)
   if [[ -f "$marker" ]]; then
     if [[ "$name" == "jaco-core" && "\${STUB_CORE_FLAP:-0}" == "1" ]]; then
       counter="$STUB_STATE/core-pid-counter"
       n=0; [[ -f "$counter" ]] && n="$(cat "$counter")"
       n=$((n+1)); printf '%s' "$n" > "$counter"
       echo "run: $name: (pid $((100+n))) 0s"
     else
       pid="$(cat "$pidfile" 2>/dev/null || echo 123)"
       echo "run: $name: (pid $pid) 1s"
     fi
   else
     echo "down: $name: 0s"
   fi
   ;;
 *) exit 2 ;;
esac
SH
cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
url="${*: -1}"
case "$url" in
 *:2999/*) [[ -f "$STUB_STATE/jaco-sentinel" ]] ;;
 *:3000/*)
   if [[ -f "$STUB_STATE/jaco-core" || "${STUB_FORCE_CORE_HTTP:-0}" == "1" || ( -n "${STUB_CORE_HTTP_PID:-}" && -d "/proc/$STUB_CORE_HTTP_PID" ) ]]; then
     if [[ "$url" == *"/api/runtime/identity" ]]; then
       printf '{"success":true,"releaseId":"%s"}\n' "$STUB_CORE_RELEASE_ID"
     fi
     exit 0
   fi
   exit 22
   ;;
 *:2995/*)
   [[ -f "$STUB_STATE/jaco-workplace" ]] || exit 22
   printf '%s\n' '{"product":"JACO Workplace","supervisedAgents":{"state":"RUNNING","nova":{"state":"RUNNING"}}}'
   ;;
 *:9380/v1/models)
   [[ -f "$STUB_STATE/llamacpp" ]] || exit 22
   printf '%s\n' '{"object":"list","data":[{"id":"__BONSAI_MODEL__","object":"model"}]}'
   ;;
 *) exit 22 ;;
esac
SH
cat > "$TMP/home/llama.cpp/build/bin/llama-server" <<'SH'
#!/usr/bin/env bash
set -eu
: > "$STUB_STATE/llamacpp"
cleanup(){ rm -f "$STUB_STATE/llamacpp"; }
trap cleanup EXIT TERM INT
while :; do sleep 1; done
SH
touch "$TMP/home/models/Bonsai-27B-Q1_0.gguf"
sed -i "s|__BONSAI_MODEL__|$TMP/home/models/Bonsai-27B-Q1_0.gguf|g" "$TMP/bin/curl"
chmod +x "$TMP/home/llama.cpp/build/bin/llama-server"
chmod +x "$TMP/bin/sv" "$TMP/bin/curl"
export STUB_STATE="$TMP/state"
# The Core launcher now verifies an actual releaseId. Test doubles must return
# a real identity response rather than an empty HTTP 200.
export STUB_CORE_RELEASE_ID="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).releaseId" "$ROOT/CURRENT_RELEASE.json")"
export HOME="$TMP/home"
export PREFIX="$TMP/prefix"
export PATH="$TMP/bin:$PATH"
export JACO_RUNTIME_ENV="$TMP/runtime.env"
export JACO_PROJECT_ENV="$TMP/project.env"
# Stale-Core cleanup scans /proc for processes whose cwd is JACO_ROOT. Point it at a
# scratch directory so the test can never match (and kill) a real runtime on this host.
export JACO_ROOT="$TMP/jaco-root"; mkdir -p "$JACO_ROOT/gateway"
# Run the exact supervisor bytes in an isolated checkout. Since the launcher
# derives its canonical root from its own script path, pointing JACO_ROOT at
# scratch via env alone is insufficient and would legitimately refuse takeover.
mkdir -p "$JACO_ROOT/bin" "$JACO_ROOT/termux"
cp "$ROOT/bin/jacoctl" "$JACO_ROOT/bin/jacoctl"
cp "$ROOT/CURRENT_RELEASE.json" "$JACO_ROOT/CURRENT_RELEASE.json"
cp -R "$ROOT/termux/services" "$JACO_ROOT/termux/"
JACO_CTL="$JACO_ROOT/bin/jacoctl"
cat > "$JACO_PROJECT_ENV" <<'ENV'
JACO_GATEWAY_TOKEN=project-token-123456789012345678901234567890
ENV
OUT="$(bash "$JACO_CTL" activate --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="READY") process.exit(1)' "$OUT"
[[ -f "$TMP/state/jaco-sentinel" && -f "$TMP/state/jaco-core" && -f "$TMP/state/jaco-workplace" ]]
grep -q "^export JACO_GATEWAY_TOKEN='project-token-" "$JACO_RUNTIME_ENV"
grep -q "^export GATEWAY_TOKEN='project-token-" "$JACO_RUNTIME_ENV"
grep -q "^export SEER_TOKEN='project-token-" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_RUNTIME_URL='http://127.0.0.1:3000'" "$JACO_RUNTIME_ENV"
grep -q "^export SEER_URL='http://127.0.0.1:2997'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_WORKPLACE_URL='http://127.0.0.1:2995'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_REMOTE_BRIDGE_PORT='2994'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_REMOTE_ALLOW_MUTATIONS='1'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_ENABLE_CDP='1'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_CDP_BRIDGE_PORT='2996'" "$JACO_RUNTIME_ENV"
grep -q "^export NOVA_BRIDGE_PORT='4243'" "$JACO_RUNTIME_ENV"
grep -q "^export CDP_PORT='9222'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_ENABLE_OLLAMA='0'" "$JACO_RUNTIME_ENV"
grep -q "^export OLLAMA_BASE_URL='http://127.0.0.1:11434'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_AUTODETECT='1'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_URL='http://127.0.0.1:9379/v1'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_MODEL=''" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LLAMACPP_URL='http://127.0.0.1:9380/v1'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LLAMACPP_MODEL='$TMP/home/models/Bonsai-27B-Q1_0.gguf'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LLAMACPP_CTX='8192'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_SEER_PROVIDER_PREFERENCE='llamacpp'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_WORKPLACE_SEER_BRAIN_MAX_TOKENS='128'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_WORKPLACE_SEER_BRAIN_TIMEOUT_MS='240000'" "$JACO_RUNTIME_ENV"
[[ "$(stat -c '%a' "$JACO_RUNTIME_ENV")" == "600" ]]
OUT_STATUS="$(bash "$JACO_CTL" status --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="READY") process.exit(1)' "$OUT_STATUS"

# A stray/stale process may keep :3000 answering even while the supervised Core
# is down. READY must follow the service graph, not only the HTTP port.
rm -f "$TMP/state/jaco-core"
export STUB_FORCE_CORE_HTTP=1
OUT_DEGRADED="$(bash "$JACO_CTL" status --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="DEGRADED" || !/Port 3000 responds but Core is not the supervised/.test(j.message)) process.exit(1)' "$OUT_DEGRADED"
unset STUB_FORCE_CORE_HTTP
: > "$TMP/state/jaco-core"

OUT2="$(bash "$JACO_CTL" deactivate --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="SENTINEL_ONLY") process.exit(1)' "$OUT2"
[[ -f "$TMP/state/jaco-sentinel" && ! -f "$TMP/state/jaco-core" ]]
[[ ! -f "$TMP/state/jaco-workplace" && ! -f "$TMP/state/jaco-ollama" && ! -f "$TMP/state/jaco-nova-bridge" && ! -f "$TMP/state/jaco-cdp" ]]



# A recognized stale Core in the canonical runtime must be terminated completely
# before runit ownership is restored. The HTTP stub follows the stale PID, so
# takeover can only proceed after that process is actually gone.
(
  cd "$JACO_ROOT"
  exec -a "node --import tsx server.ts" sleep 30
) &
STALE_PID=$!
export STUB_CORE_HTTP_PID="$STALE_PID"
export JACO_STALE_CORE_TERM_SECONDS=1
export JACO_STALE_CORE_KILL_SECONDS=1
OUT_RECOVER="$(bash "$JACO_CTL" activate --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="READY") process.exit(1)' "$OUT_RECOVER"
if kill -0 "$STALE_PID" 2>/dev/null; then
  echo "recognized stale Core survived takeover" >&2
  exit 1
fi
bash "$JACO_CTL" deactivate --json >/dev/null
unset STUB_CORE_HTTP_PID JACO_STALE_CORE_TERM_SECONDS JACO_STALE_CORE_KILL_SECONDS

# If an endpoint survives canonical cleanup while the supervised Core is down,
# jacoctl must refuse to create a runit restart loop against an unknown owner.
export STUB_FORCE_CORE_HTTP=1
set +e
OUT_BLOCKED="$(bash "$JACO_CTL" activate --json 2>/dev/null)"
RC_BLOCKED=$?
set -e
[[ "$RC_BLOCKED" -eq 35 ]]
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="DEGRADED" || !/ownership recovery failed/.test(j.message)) process.exit(1)' "$OUT_BLOCKED"
[[ ! -f "$TMP/state/jaco-core" && ! -f "$TMP/state/jaco-workplace" ]]
unset STUB_FORCE_CORE_HTTP

# A Core that answers HTTP but changes supervised PID between stability probes
# is not READY. Dependents must remain down.
export STUB_CORE_FLAP=1
export JACO_STABILITY_PROBE_SECONDS=0
export JACO_CORE_READY_WAIT_SECONDS=2
set +e
OUT_FLAP="$(bash "$JACO_CTL" activate --json 2>/dev/null)"
RC_FLAP=$?
set -e
[[ "$RC_FLAP" -eq 34 ]]
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="DEGRADED" || !/failed stability gate/.test(j.message)) process.exit(1)' "$OUT_FLAP"
[[ -f "$TMP/state/jaco-core" && ! -f "$TMP/state/jaco-workplace" ]]
bash "$JACO_CTL" deactivate --json >/dev/null
unset STUB_CORE_FLAP JACO_STABILITY_PROBE_SECONDS JACO_CORE_READY_WAIT_SECONDS

# Restart must not cancel an in-flight shutdown by issuing svc_up against the
# old owner. If Workplace refuses TERM, restart fails closed before Core is
# started again.
bash "$JACO_CTL" activate --json >/dev/null
export STUB_REFUSE_DOWN_SERVICE=jaco-workplace
export JACO_WORKPLACE_STOP_WAIT_SECONDS=1
set +e
OUT_STUCK_RESTART="$(bash "$JACO_CTL" restart --json 2>/dev/null)"
RC_STUCK_RESTART=$?
set -e
[[ "$RC_STUCK_RESTART" -eq 37 ]]
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="DEGRADED" || !/Workplace did not stop cleanly/.test(j.message)) process.exit(1)' "$OUT_STUCK_RESTART"
[[ -f "$TMP/state/jaco-workplace" ]]
[[ ! -f "$TMP/state/jaco-core" ]]
unset STUB_REFUSE_DOWN_SERVICE JACO_WORKPLACE_STOP_WAIT_SECONDS
bash "$JACO_CTL" deactivate --json >/dev/null

# Live 2026-09-30: an old Core that no longer answered HTTP kept the ledger lock, so every new
# supervised Core stayed unready. activate must stop a silent stale Core from this checkout too.
(
  cd "$JACO_ROOT"
  exec -a "node --import tsx server.ts" sleep 30
) &
SILENT_CORE=$!
export JACO_STALE_CORE_TERM_SECONDS=1 JACO_STALE_CORE_KILL_SECONDS=1
OUT_SILENT="$(bash "$JACO_CTL" activate --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="READY") process.exit(1)' "$OUT_SILENT"
if kill -0 "$SILENT_CORE" 2>/dev/null; then echo "silent stale Core survived activate" >&2; exit 1; fi
bash "$JACO_CTL" deactivate --json >/dev/null
unset JACO_STALE_CORE_TERM_SECONDS JACO_STALE_CORE_KILL_SECONDS

# Live 2026-09-30: an orphan Workplace outside runit kept respawning llama-server with a 2048-token
# context across an upgrade. activate must stop orphans from this checkout (and the model server on
# JACO's port) before starting the supervised Workplace, and leave unrelated processes alone.
(
  cd "$JACO_ROOT/.."
  exec -a "node --experimental-sqlite gateway/src/workplace/workplace-server.mjs" sleep 30
) &
ORPHAN_WORKPLACE=$!
( exec -a "llama-server -m model.gguf -c 2048 --host 127.0.0.1 --port 9380" sleep 30 ) &
ORPHAN_LLAMA=$!
( cd "$JACO_ROOT/.."; exec -a "node unrelated-tool.mjs" sleep 30 ) &
BYSTANDER=$!
export JACO_STALE_CORE_TERM_SECONDS=1 JACO_STALE_CORE_KILL_SECONDS=1
# A run script changed by git pull must replace the copy runit executes.
mkdir -p "$JACO_ROOT/termux/services/jaco-core"
printf '#!/bin/sh\necho updated-core-run\n' > "$JACO_ROOT/termux/services/jaco-core/run"
OUT_ORPHAN="$(bash "$JACO_CTL" activate --json)"
node -e 'const j=JSON.parse(process.argv[1]); if(j.state!=="READY") process.exit(1)' "$OUT_ORPHAN"
for pid in "$ORPHAN_WORKPLACE" "$ORPHAN_LLAMA"; do
  if kill -0 "$pid" 2>/dev/null; then echo "orphan pid=$pid survived activate" >&2; exit 1; fi
done
kill -0 "$BYSTANDER" 2>/dev/null || { echo "unrelated process was killed" >&2; exit 1; }
kill "$BYSTANDER" 2>/dev/null || true
grep -q updated-core-run "$TMP/prefix/var/service/jaco-core/run"
[[ -x "$TMP/prefix/var/service/jaco-core/run" ]]
unset JACO_STALE_CORE_TERM_SECONDS JACO_STALE_CORE_KILL_SECONDS
bash "$JACO_CTL" deactivate --json >/dev/null

echo 'PASS jacoctl: fixed lifecycle verbs activate/deactivate/restart via runit service boundary'
