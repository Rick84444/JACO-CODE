#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/tunnel-client" <<'FAKE'
#!/usr/bin/env sh
printf '%s\n' "$*" > "$JACO_FAKE_TUNNEL_LOG"
exit 0
FAKE
chmod +x "$TMP/bin/tunnel-client"
cat > "$TMP/bin/curl" <<'FAKE'
#!/usr/bin/env sh
exit 0
FAKE
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH"
export JACO_FAKE_TUNNEL_LOG="$TMP/log"
export JACO_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef
export JACO_TUNNEL_RUNTIME_KEY=test_only_not_persisted
export JACO_TUNNEL_MCP_URL=http://127.0.0.1:2999/mcp
bash "$ROOT/bin/jaco-tunnel" connect
line="$(cat "$TMP/log")"
[[ "$line" == *"runtimes connect"* ]]
[[ "$line" == *"--tunnel-id tunnel_0123456789abcdef0123456789abcdef"* ]]
[[ "$line" == *"--runtime-api-key env:JACO_TUNNEL_RUNTIME_KEY"* ]]
[[ "$line" == *"--mcp-server-url http://127.0.0.1:2999/mcp"* ]]
[[ "$line" != *"test_only_not_persisted"* ]]
printf '%s\n' 'PASS jaco-tunnel: fixed official tunnel-client flow; runtime key is referenced by env, not serialized'
