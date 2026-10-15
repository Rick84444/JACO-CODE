#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
STATE="$ROOT/.jaco/candidate"; mkdir -p "$STATE"; chmod 700 "$ROOT/.jaco" "$STATE" 2>/dev/null || true
CORE_PORT="${JACO_CANDIDATE_CORE_PORT:-3020}"; SENTINEL_PORT="${JACO_CANDIDATE_SENTINEL_PORT:-3299}"; A2A_PORT="${JACO_CANDIDATE_A2A_PORT:-3298}"; CANONICAL_PORT="${JACO_CANONICAL_PORT:-3000}"
EXPECTED='runtime'
log(){ printf '[CONTINUUM CANDIDATE] %s\n' "$*"; }; die(){ printf '[CONTINUUM CANDIDATE] FAIL %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null || die 'Node 22+ required'; [[ $(node -p "Number(process.versions.node.split('.')[0])") -ge 22 ]] || die "Node 22+ required; found $(node -v)"
for p in "$CORE_PORT" "$SENTINEL_PORT" "$A2A_PORT"; do
  if (echo >/dev/tcp/127.0.0.1/$p) >/dev/null 2>&1; then die "candidate port $p already occupied"; fi
done
canonical="$(curl -fsS --max-time 2 "http://127.0.0.1:$CANONICAL_PORT/api/runtime/identity" 2>/dev/null || true)"; printf '%s' "$canonical" > "$STATE/canonical-before.json"
TOKEN="${JACO_CANDIDATE_CONTINUUM_TOKEN:-$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")}"; SENTINEL_TOKEN="${JACO_CANDIDATE_SENTINEL_BEARER:-$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")}"; A2A_TOKEN="${JACO_CANDIDATE_A2A_BEARER:-$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")}";
cat > "$STATE/candidate.env" <<ENV
JACO_CONTINUUM_TOKEN=$TOKEN
JACO_CONTINUUM_SENTINEL_BEARER=$SENTINEL_TOKEN
JACO_A2A_BEARER=$A2A_TOKEN
ENV
chmod 600 "$STATE/candidate.env"
JACO_CONTINUUM_HOST=127.0.0.1 JACO_CONTINUUM_PORT="$CORE_PORT" JACO_CONTINUUM_TOKEN="$TOKEN" JACO_SUBSTRATE_URL="http://127.0.0.1:$CANONICAL_PORT" JACO_CONTINUUM_AUTOSTART=1 node src/server/continuum/standalone-server.mjs >"$STATE/core.out.log" 2>"$STATE/core.err.log" & echo $! > "$STATE/core.pid"
for _ in $(seq 1 60); do identity="$(curl -fsS --max-time 2 "http://127.0.0.1:$CORE_PORT/api/runtime/identity" 2>/dev/null || true)"; [[ "$identity" == *"$EXPECTED"* ]] && break; sleep .25; done
[[ "${identity:-}" == *"$EXPECTED"* ]] || { bash "$ROOT/termux/stop-continuum-candidate.sh" || true; die "Continuum failed; inspect $STATE/core.err.log"; }
JACO_CONTINUUM_SENTINEL_HOST=127.0.0.1 JACO_CONTINUUM_SENTINEL_PORT="$SENTINEL_PORT" JACO_CONTINUUM_URL="http://127.0.0.1:$CORE_PORT" JACO_CONTINUUM_TOKEN="$TOKEN" JACO_CONTINUUM_SENTINEL_BEARER="$SENTINEL_TOKEN" node gateway/src/continuum-sentinel.mjs >"$STATE/sentinel.out.log" 2>"$STATE/sentinel.err.log" & echo $! > "$STATE/sentinel.pid"
JACO_A2A_HOST=127.0.0.1 JACO_A2A_PORT="$A2A_PORT" JACO_BASE_URL="http://127.0.0.1:$CORE_PORT" JACO_CONTINUUM_TOKEN="$TOKEN" JACO_A2A_BEARER="$A2A_TOKEN" node gateway/src/a2a-server.mjs >"$STATE/a2a.out.log" 2>"$STATE/a2a.err.log" & echo $! > "$STATE/a2a.pid"
for _ in $(seq 1 40); do sentinel="$(curl -fsS --max-time 2 "http://127.0.0.1:$SENTINEL_PORT/health" 2>/dev/null || true)"; a2a="$(curl -fsS --max-time 2 "http://127.0.0.1:$A2A_PORT/health" 2>/dev/null || true)"; [[ "$sentinel" == *"0.22.0"* && "$a2a" == *"0.22.0"* ]] && break; sleep .25; done
[[ "${sentinel:-}" == *"0.22.0"* ]] || die "Sentinel failed; inspect $STATE/sentinel.err.log"; [[ "${a2a:-}" == *"0.22.0"* ]] || die "A2A failed; inspect $STATE/a2a.err.log"
status="$(curl -fsS -H "x-jaco-continuum-token: $TOKEN" "http://127.0.0.1:$CORE_PORT/api/continuum/status")"; integrity="$(curl -fsS -H "x-jaco-continuum-token: $TOKEN" "http://127.0.0.1:$CORE_PORT/api/continuum/integrity")"; [[ "$integrity" == *'"valid":true'* ]] || die 'event integrity gate failed'
CANDIDATE_ROOT="$ROOT" CORE_PORT="$CORE_PORT" SENTINEL_PORT="$SENTINEL_PORT" A2A_PORT="$A2A_PORT" CANONICAL_PORT="$CANONICAL_PORT" node - <<'NODE' > "$STATE/candidate-proof.json"
const fs=require('fs'),p=process.env.CANDIDATE_ROOT+'/.jaco/candidate/';const j=f=>{try{return JSON.parse(fs.readFileSync(p+f,'utf8')||'{}')}catch{return null}};
console.log(JSON.stringify({schema:'jaco.continuum.candidate-proof.v1',releaseId:'jaco-code-0.22.0',verifiedAt:new Date().toISOString(),candidateRoot:process.env.CANDIDATE_ROOT,architecture:'SIDECAR_CONTROL_PLANE',ports:{continuum:+process.env.CORE_PORT,sentinel:+process.env.SENTINEL_PORT,a2a:+process.env.A2A_PORT},executionSubstrate:{port:+process.env.CANONICAL_PORT,identity:j('canonical-before.json')},pids:{continuum:+fs.readFileSync(p+'core.pid'),sentinel:+fs.readFileSync(p+'sentinel.pid'),a2a:+fs.readFileSync(p+'a2a.pid')},checks:{identity:true,continuumStatus:true,eventIntegrity:true,sentinelHealth:true,a2aHealth:true},truthBoundary:'TARGET_CANDIDATE_RUNTIME_VERIFIED; SUBSTRATE_CAPABILITIES_SEPARATELY_VERIFIED'},null,2));
NODE
log "PASS sidecar READY: Continuum=$CORE_PORT Sentinel=$SENTINEL_PORT A2A=$A2A_PORT"; log "Existing Core :$CANONICAL_PORT remains untouched as execution substrate"; log "Proof: $STATE/candidate-proof.json"
