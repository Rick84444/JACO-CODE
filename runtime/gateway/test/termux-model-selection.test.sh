#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/state" "$TMP/runtime" "$TMP/models"
for svc in jaco-sentinel jaco-core jaco-workplace jaco-nova jaco-ollama jaco-nova-bridge jaco-cdp; do
  mkdir -p "$TMP/services/$svc/supervise"
  touch "$TMP/services/$svc/supervise/ok"
done
cat > "$TMP/bin/sv" <<'SH'
#!/usr/bin/env bash
set -eu
marker="$JACO_MODEL_TEST_STATE/$(basename "$2")"
case "$1" in
  up) touch "$marker" ;;
  down) rm -f "$marker" ;;
  status) if [[ -f "$marker" ]]; then echo 'run: fixture: (pid 123) 1s'; else echo 'down: fixture: 0s'; fi ;;
  *) exit 2 ;;
esac
SH
cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
case "${*: -1}" in
  *:2999/*) [[ -f "$JACO_MODEL_TEST_STATE/jaco-sentinel" ]] ;;
  *:3000/*) [[ -f "$JACO_MODEL_TEST_STATE/jaco-core" ]] ;;
  *:2995/*)
    [[ -f "$JACO_MODEL_TEST_STATE/jaco-workplace" ]] || exit 22
    echo '{"supervisedAgents":{"state":"RUNNING","nova":{"state":"RUNNING"}}}'
    ;;
  *:9379/v1/models)
    [[ "${JACO_MODEL_TEST_LITERT_READY:-0}" == 1 ]] || exit 22
    echo '{"data":[{"id":"gemma4-e2b"}]}'
    ;;
  *) exit 22 ;;
esac
SH
printf '#!/usr/bin/env sh\nexit 0\n' > "$TMP/bin/litert-lm"
printf '#!/usr/bin/env sh\nexit 0\n' > "$TMP/bin/llama-server"
chmod +x "$TMP/bin/"*
touch "$TMP/models/local.gguf"
export PATH="$TMP/bin:$PATH"
export SVDIR="$TMP/services"
export JACO_ROOT="$TMP/runtime"
export JACO_RUNTIME_ENV="$TMP/runtime.env"
export JACO_PROJECT_ENV="$TMP/project.env"
export JACO_MODEL_TEST_STATE="$TMP/state"
export JACO_MODEL_TEST_LITERT_READY=1
export JACO_STABILITY_PROBE_SECONDS=0
export JACO_LLAMACPP_SERVER="$TMP/bin/llama-server"
export JACO_LLAMACPP_MODEL="$TMP/models/local.gguf"
cat > "$JACO_PROJECT_ENV" <<'ENV'
JACO_GATEWAY_TOKEN=fixture-token-12345678901234567890
JACO_SEER_PROVIDER_PREFERENCE=auto
JACO_LITERT_MODEL=
ENV

# Auto selection keeps healthy LiteRT first even with a complete llama.cpp install.
OUT="$(bash "$ROOT/bin/jacoctl" activate --json)"
node -e 'if(JSON.parse(process.argv[1]).state!=="READY")process.exit(1)' "$OUT"
grep -q "^export JACO_SEER_PROVIDER_PREFERENCE='auto'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_MODEL=''" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_COMMAND='$TMP/bin/litert-lm'" "$JACO_RUNTIME_ENV"

# An explicit choice overrides stale project/runtime settings and old cloud planning.
cat >> "$JACO_PROJECT_ENV" <<'ENV'
export JACO_SEER_PROVIDER_PREFERENCE=llamacpp
export JACO_LITERT_MODEL=gemma-4-E4B-it-gpu.litertlm
export JACO_CLOUD_PLANNER=1
export JACO_ALLOW_PAID_MODELS=1
export UNRELATED_MODEL_SETTING=preserved
ENV
OUT="$(bash "$ROOT/bin/jacoctl" restart --provider litert --model gemma4-e2b --json)"
node -e 'if(JSON.parse(process.argv[1]).state!=="READY")process.exit(1)' "$OUT"
for file in "$JACO_RUNTIME_ENV" "$JACO_PROJECT_ENV"; do
  grep -q "^export JACO_SEER_PROVIDER_PREFERENCE='litert'" "$file"
  grep -q "^export JACO_LITERT_MODEL='gemma4-e2b'" "$file"
  grep -q "^export JACO_CLOUD_PLANNER='0'" "$file"
  grep -q "^export JACO_ALLOW_PAID_MODELS='0'" "$file"
  [[ "$(grep -c '^export JACO_LITERT_MODEL=' "$file")" == 1 ]]
  [[ "$(stat -c '%a' "$file")" == 600 ]]
done
grep -q '^export UNRELATED_MODEL_SETTING=preserved' "$JACO_PROJECT_ENV"
grep -q '^JACO_GATEWAY_TOKEN=fixture-token-' "$JACO_PROJECT_ENV"

# A restart without flags must keep the saved choice and must not select llama.cpp.
bash "$ROOT/bin/jacoctl" activate --json >/dev/null
grep -q "^export JACO_SEER_PROVIDER_PREFERENCE='litert'" "$JACO_RUNTIME_ENV"
grep -q "^export JACO_LITERT_MODEL='gemma4-e2b'" "$JACO_RUNTIME_ENV"
bash "$ROOT/bin/jacoctl" restart --provider litert --json >/dev/null
for file in "$JACO_RUNTIME_ENV" "$JACO_PROJECT_ENV"; do grep -q "^export JACO_LITERT_MODEL=''" "$file"; done
bash "$ROOT/bin/jacoctl" restart --provider ollama --model configured:4b --json >/dev/null
grep -q "^export JACO_SEER_PROVIDER_PREFERENCE='ollama'" "$JACO_RUNTIME_ENV"
grep -q "^export OLLAMA_MODEL='configured:4b'" "$JACO_RUNTIME_ENV"

# Invalid flags fail before either file or the service markers change.
BEFORE_RUNTIME="$(cksum < "$JACO_RUNTIME_ENV")"
BEFORE_PROJECT="$(cksum < "$JACO_PROJECT_ENV")"
BEFORE_SERVICES="$(find "$TMP/state" -type f | sort)"
for args in '--provider missing' '--model gemma4-e2b' '--provider auto --model gemma4-e2b'; do
  read -r -a invalid_args <<< "$args"
  if bash "$ROOT/bin/jacoctl" restart "${invalid_args[@]}" --json >/dev/null 2>&1; then exit 1; fi
done
if bash "$ROOT/bin/jacoctl" status --provider litert >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/bin/jacoctl" restart --provider litert --model 'invalid model' >/dev/null 2>&1; then exit 1; fi
[[ "$(cksum < "$JACO_RUNTIME_ENV")" == "$BEFORE_RUNTIME" ]]
[[ "$(cksum < "$JACO_PROJECT_ENV")" == "$BEFORE_PROJECT" ]]
[[ "$(find "$TMP/state" -type f | sort)" == "$BEFORE_SERVICES" ]]
bash "$ROOT/bin/jacoctl" deactivate --json >/dev/null
echo 'PASS: Termux model selection, persistence, LiteRT priority, CLI path, cloud gate and invalid-flag refusal'
