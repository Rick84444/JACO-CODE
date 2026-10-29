#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/prefix/bin" "$TMP/home" "$TMP/workspace/runtime"
: > "$TMP/workspace/runtime/run_termux_node.sh"
ln -s "$(command -v mkdir)" "$TMP/prefix/bin/mkdir"
cat > "$TMP/prefix/bin/node" <<'SH'
#!/bin/sh
[ "${JACO_CHATGPT_WORKPLACE_TOKEN:-}" = 'synthetic-test-only-token' ] && present=1 || present=0
printf 'TOKEN_PRESENT=%s\n' "$present"
printf 'REPO=%s\n' "${JACO_CHATGPT_WORKPLACE_REPO:-unset}"
SH
cat > "$TMP/prefix/bin/gh" <<'SH'
#!/bin/sh
[ "$1" = auth ] && [ "$2" = token ] || exit 8
printf 'synthetic-test-only-token\n'
SH
chmod +x "$TMP/prefix/bin/node" "$TMP/prefix/bin/gh"
cat > "$TMP/runtime.env" <<EOF
export JACO_ROOT='$TMP/workspace/runtime'
export JACO_CHATGPT_WORKPLACE_REPO='Rick84444/private-relay-fixture'
export JACO_CHATGPT_WORKPLACE_ACTOR='Rick84444'
EOF

call_service() {
  env -u JACO_CHATGPT_WORKPLACE_TOKEN -u GH_TOKEN -u GITHUB_TOKEN -u JACO_CHATGPT_WORKPLACE_GH_CLI \
    PREFIX="$TMP/prefix" HOME="$TMP/home" JACO_RUNTIME_ENV="$TMP/runtime.env" \
    sh "$ROOT/termux/services/jaco-workplace/run"
}
OUT="$(call_service)"
[[ "$OUT" == *"TOKEN_PRESENT=0"* ]]
[[ "$OUT" == *"REPO=Rick84444/private-relay-fixture"* ]]
printf 'export JACO_CHATGPT_WORKPLACE_GH_CLI=1\n' >> "$TMP/runtime.env"
OUT="$(call_service)"
[[ "$OUT" == *"TOKEN_PRESENT=1"* ]]
[[ "$OUT" == *"REPO=Rick84444/private-relay-fixture"* ]]

cat > "$TMP/prefix/bin/gh" <<'SH'
#!/bin/sh
exit 9
SH
set +e
OUT="$(call_service 2>&1)"
RC=$?
set -e
[[ "$RC" -eq 45 ]]
[[ "$OUT" == *"JACO_CHATGPT_RELAY_GH_AUTH_REQUIRED"* ]]
[[ "$OUT" != *"synthetic-test-only-token"* ]]
sh -n "$ROOT/termux/services/jaco-workplace/run"
echo 'PASS Workplace relay: opt-in, private target, token-not-logged, fail-closed'
