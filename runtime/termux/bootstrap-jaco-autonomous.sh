#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RUNTIME="$ROOT/.jaco/runtime"
mkdir -p "$RUNTIME"
chmod 700 "$ROOT/.jaco" "$RUNTIME" 2>/dev/null || true
EXPECTED_RELEASE='runtime'
CORE_PORT="${PORT:-3000}"
MCP_PORT="${JACO_GATEWAY_PORT:-2999}"
PROVIDER_ID="${JACO_BOOTSTRAP_PROVIDER:-ollama}"

step(){ printf '[JACO AUTO] %s\n' "$*"; }
good(){ printf '[JACO AUTO] PASS  %s\n' "$*"; }
warn(){ printf '[JACO AUTO] WARN  %s\n' "$*"; }
die(){ printf '[JACO AUTO] FAIL  %s\n' "$*" >&2; exit 1; }
rand_token(){ node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"; }
json_get(){ node -e "const x=JSON.parse(require('fs').readFileSync(0,'utf8')); let v=x; for(const k of process.argv[1].split('.')) v=v?.[k]; if(v!==undefined&&v!==null) process.stdout.write(typeof v==='object'?JSON.stringify(v):String(v));" "$1"; }

command -v node >/dev/null 2>&1 || die 'Node.js is required'
command -v npm >/dev/null 2>&1 || die 'npm is required'
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node 22+ required; found $(node -v)"
good "Node $(node -v)"

ENV_FILE="$RUNTIME/autonomous-bootstrap.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE" || true; set +a
fi
export GATEWAY_TOKEN="${GATEWAY_TOKEN:-$(rand_token)}"
export JACO_GATEWAY_TOKEN="$GATEWAY_TOKEN"
export JACO_MCP_BEARER="${JACO_MCP_BEARER:-$(rand_token)}"
export HOST='127.0.0.1'
export PORT="$CORE_PORT"
export JACO_BASE_URL="http://127.0.0.1:$CORE_PORT"

LAN_IP="${JACO_LAN_IP:-}"
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)"
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1 || true)"
fi

identity_json="$(curl -fsS --max-time 2 "http://127.0.0.1:$CORE_PORT/api/runtime/identity" 2>/dev/null || true)"
if [[ -n "$identity_json" ]]; then
  observed="$(printf '%s' "$identity_json" | json_get releaseId 2>/dev/null || true)"
  if [[ "$observed" != "$EXPECTED_RELEASE" ]]; then
    die "Different canonical JACO runtime is active ($observed). Preserve it; run START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh and promote only after candidate proof."
  fi
fi

if [[ -z "$identity_json" ]]; then
  [[ -d node_modules ]] || npm ci --ignore-scripts --no-audit --no-fund
  node scripts/ensure_rollup_native.mjs
  if [[ ! -f dist/server.cjs || "${JACO_BOOTSTRAP_REBUILD:-1}" == '1' ]]; then
    step 'Building canonical JACO Autonomous IDE + Core'
    npm run build
  fi
  node dist/server.cjs >"$RUNTIME/core.autonomous.out.log" 2>"$RUNTIME/core.autonomous.err.log" &
  CORE_PID=$!
  for _ in $(seq 1 50); do
    identity_json="$(curl -fsS --max-time 2 "http://127.0.0.1:$CORE_PORT/api/runtime/identity" 2>/dev/null || true)"
    [[ -n "$identity_json" ]] && break
    sleep 0.5
  done
  [[ -n "$identity_json" ]] || die "Core did not become READY; inspect $RUNTIME/core.autonomous.err.log"
  good "Core READY PID=$CORE_PID"
else
  good "Reusing current Continuum Core :$CORE_PORT"
fi

# Local runtime API auth remains loopback; gateway token is used when Core was started by this bootstrap.
HDR=(-H "x-gateway-token: $GATEWAY_TOKEN")
curl -fsS --max-time 8 -X POST "http://127.0.0.1:$CORE_PORT/api/connected/dispatcher/start" "${HDR[@]}" -H 'content-type: application/json' -d '{"intervalMs":1200}' >/dev/null || warn 'Connected dispatcher start was not acknowledged'
seer_json="$(curl -fsS --max-time 5 "http://127.0.0.1:$CORE_PORT/api/seer/live" 2>/dev/null || true)"
[[ -n "$seer_json" ]] && good 'SEER live READY' || warn 'SEER live unavailable'

provider_json="$(curl -fsS --max-time 8 -X POST "http://127.0.0.1:$CORE_PORT/api/connected/providers/$PROVIDER_ID/probe" "${HDR[@]}" -H 'content-type: application/json' -d '{}' 2>/dev/null || true)"
if [[ -n "$provider_json" ]] && [[ "$(printf '%s' "$provider_json" | json_get success 2>/dev/null || true)" == 'true' ]]; then good "Provider $PROVIDER_ID READY"; else warn "Provider $PROVIDER_ID unavailable"; fi

android_json="$(curl -fsS --max-time 4 "http://127.0.0.1:$CORE_PORT/api/hands-off/status" "${HDR[@]}" 2>/dev/null || true)"
[[ -n "$android_json" ]] && good 'Android Hands-Off status observed' || warn 'Android Accessibility bridge unavailable/unconfigured'

if [[ -n "$LAN_IP" ]]; then
  export JACO_GATEWAY_HOST='0.0.0.0'
  export JACO_GATEWAY_PORT="$MCP_PORT"
  export JACO_GATEWAY_MODE='lan'
  export JACO_ALLOWED_HOSTS="127.0.0.1,localhost,[::1],$LAN_IP"
  export JACO_MODEL_ID='jaco-autonomous-bootstrap'
  export JACO_MCP_ALLOW_ACTIVATION='0'
  [[ -d gateway/node_modules/@modelcontextprotocol/server ]] || (cd gateway && npm install --ignore-scripts --no-audit --no-fund)
  node gateway/test/mcp-runtime.test.mjs || warn 'Official MCP SDK negotiation gate failed'
  sentinel_health="$(curl -fsS --max-time 2 -H "Host: $LAN_IP:$MCP_PORT" -H "Authorization: Bearer $JACO_MCP_BEARER" "http://127.0.0.1:$MCP_PORT/health" 2>/dev/null || true)"
  if [[ -z "$sentinel_health" ]]; then
    node gateway/src/sentinel.mjs >"$RUNTIME/sentinel.autonomous.out.log" 2>"$RUNTIME/sentinel.autonomous.err.log" &
    MCP_PID=$!
    for _ in $(seq 1 30); do
      sentinel_health="$(curl -fsS --max-time 2 -H "Host: $LAN_IP:$MCP_PORT" -H "Authorization: Bearer $JACO_MCP_BEARER" "http://127.0.0.1:$MCP_PORT/health" 2>/dev/null || true)"
      [[ -n "$sentinel_health" ]] && break
      sleep 0.5
    done
  fi
  if [[ -n "$sentinel_health" ]]; then good "MCP Sentinel READY http://$LAN_IP:$MCP_PORT/mcp"; else warn 'MCP Sentinel unavailable'; fi
else
  warn 'No LAN IPv4 found; Wi-Fi MCP not started'
fi

cat > "$ENV_FILE" <<ENV
JACO_LAN_IP=$LAN_IP
GATEWAY_TOKEN=$GATEWAY_TOKEN
JACO_MCP_BEARER=$JACO_MCP_BEARER
ENV
chmod 600 "$ENV_FILE"

node - <<'NODE' > "$RUNTIME/autonomous-bootstrap-state.json"
const fs=require('fs');
const out={
  releaseId:'jaco-code-0.22.0',
  completedAt:new Date().toISOString(),
  core:'READY',
  seer:process.env.J_SEER||'OBSERVED',
  provider:process.env.J_PROVIDER||'PROBED',
  android:process.env.J_ANDROID||'OBSERVED',
  mcpUrl:process.env.JACO_LAN_IP?`http://${process.env.JACO_LAN_IP}:${process.env.JACO_GATEWAY_PORT||2999}/mcp`:null
};
process.stdout.write(JSON.stringify(out,null,2));
NODE

printf '\n=== JACO AUTONOMOUS BOOTSTRAP ===\n'
printf 'Core:     http://127.0.0.1:%s\n' "$CORE_PORT"
printf 'SEER:     http://127.0.0.1:%s/api/seer/live\n' "$CORE_PORT"
[[ -n "$LAN_IP" ]] && printf 'MCP:      http://%s:%s/mcp\n' "$LAN_IP" "$MCP_PORT"
printf 'State:    %s\n' "$RUNTIME/autonomous-bootstrap-state.json"
printf 'Secrets:  stored locally in %s; not printed\n' "$ENV_FILE"
