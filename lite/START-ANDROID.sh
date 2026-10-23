#!/data/data/com.termux/files/usr/bin/bash
# JACO Lite Android: platform-specific entrypoint to the same verified IDE.
# One existing Lite lifecycle owner; never stop unrelated processes or run another supervisor.
set -Eeuo pipefail

fail() { printf 'JACO Lite Android: %s\n' "$1" >&2; exit "${2:-1}"; }
command -v pkg >/dev/null 2>&1 || fail 'Launch this Android edition inside Termux.' 2
command -v node >/dev/null 2>&1 || fail 'Node.js missing. Install with: pkg install nodejs-lts' 2

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "$DIR" in
  /sdcard|/sdcard/*|/storage|/storage/*|/mnt/media_rw/*)
    fail 'Extract the Android ZIP under Termux private HOME, not Android shared storage.' 3 ;;
esac
[[ -f "$DIR/start.mjs" && -f "$DIR/release.json" ]] ||
  fail 'Incomplete package: use the Android ZIP, not an unbuilt Git checkout.' 3

PLATFORM="$(node -e '
  try {const r = require(process.argv[1]); process.stdout.write(String(r.platform || "universal"))}
  catch {process.exit(3)}
' "$DIR/release.json")" || fail 'Invalid Lite release manifest.' 3
case "$PLATFORM" in
  android|universal) ;;
  *) fail "Package platform=$PLATFORM; install the Android edition." 3 ;;
esac

node -e 'const [a,b] = process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' ||
  fail 'Node 22.5 or newer required: pkg install nodejs-lts' 2
node --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1 ||
  fail 'Termux Node.js cannot import node:sqlite.' 2

# Full runit Core/Workplace and portable Lite must not own the phone concurrently.
# Inspect but NEVER kill, disable or overwrite an existing service.
if command -v sv >/dev/null 2>&1; then
  for svc in jaco-core jaco-workplace; do
    service="${PREFIX:-/data/data/com.termux/files/usr}/var/service/$svc"
    [[ -d "$service" ]] || continue
    state="$(sv status "$service" 2>/dev/null || true)"
    case "$state" in
      run:*) fail "Full JACO $svc is running. Stop it using its own jacoctl before launching Lite." 35 ;;
    esac
  done
fi
# Also refuse manual JACO already on the canonical port (outside runit).
if command -v curl >/dev/null 2>&1 && \
   curl -fsS --max-time 2 http://127.0.0.1:3000/api/runtime/identity 2>/dev/null |
   node -e 'let s="";process.stdin.on("data",v=>s+=v).on("end",()=>{try{const x=JSON.parse(s);process.exit(x.success===true&&x.product==="JACO Autonomus IDE"?0:1)}catch{process.exit(1)}})'; then
  fail 'JACO already owns port 3000. Stop that instance before launching Lite.' 35
fi

PROJECT="${JACO_LITE_PROJECT:-$HOME/workspace}"
case "$PROJECT" in
  /sdcard|/sdcard/*|/storage|/storage/*|/mnt/media_rw/*)
    fail 'Use a project in Termux private HOME, for reliable Git and SQLite state.' 3 ;;
esac
export JACO_LITERT_URL="${JACO_LITERT_URL:-http://127.0.0.1:9379/v1}"
export JACO_LITERT_AUTODETECT="${JACO_LITERT_AUTODETECT:-1}"
export JACO_LITE_NO_UPDATE_CHECK="${JACO_LITE_NO_UPDATE_CHECK:-1}"

# Wake Lock is optional and shared Termux state, not an OOM or Doze guarantee.
if [[ "${JACO_ANDROID_WAKE_LOCK:-0}" == 1 ]]; then
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || printf 'JACO Lite Android: Wake Lock unavailable.\n' >&2
  fi
fi

printf 'JACO Lite Android: edition=%s project=%s\n' "$PLATFORM" "$PROJECT"
if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "${JACO_LITERT_URL%/}/models" >/dev/null 2>&1; then
  printf 'LiteRT registry: responding\n'
else
  printf 'LiteRT registry: not ready (Aura may still open; connect the model separately)\n'
fi
# Reuse the existing, integrity-verifying Lite lifecycle owner.
exec node "$DIR/start.mjs" "$PROJECT" --no-open "$@"
