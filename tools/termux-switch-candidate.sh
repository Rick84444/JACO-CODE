#!/data/data/com.termux/files/usr/bin/bash
# Opt-in development release switch for the existing supervised Termux installation.
# Operates on the CURRENT checkout, not a second runtime with conflicting ports.
set -Eeuo pipefail
umask 077

fail() { printf '[JACO upgrade] BLOCKED: %s\n' "$*" >&2; exit 1; }
info() { printf '[JACO upgrade] %s\n' "$*" >&2; }

[[ $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || fail 'Supply the exact 40-character candidate commit SHA.'
TARGET="$1"
[[ -n "${PREFIX:-}" && "${PREFIX}" == *com.termux* ]] || fail 'This procedure requires the existing Termux installation.'
for cmd in git node bash; do command -v "$cmd" >/dev/null 2>&1 || fail "Missing command: $cmd"; done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run this command inside the JACO Git checkout.'
cd "$ROOT"
RUNTIME="$ROOT/runtime"
CTL="$RUNTIME/bin/jacoctl"
[[ -f "$CTL" ]] || fail 'Canonical JACO runtime supervisor not found.'
[[ -d "$PREFIX/var/service/jaco-core" && -d "$PREFIX/var/service/jaco-workplace" ]] || fail 'Installed Termux service ownership not found; no changes made.'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Tracked files have local changes; refusing to overwrite. Commit or stash them first.'
git cat-file -e "$TARGET^{commit}" 2>/dev/null || fail 'Candidate commit has not been fetched.'
[[ -z "$(git diff --name-only HEAD "$TARGET" -- '*package.json' '*package-lock.json')" ]] || fail 'Candidate changes dependency manifests; install/migration needs review.'
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 24 )) || fail "JACO requires Node 24+, found $(node -v)."
BEFORE="$(git rev-parse HEAD)"
if [[ "$BEFORE" == "$TARGET" ]]; then
  info "Already at target ${TARGET:0:12}; checking canonical runtime readiness."
  STATUS="$(bash "$CTL" status --json)"
  node -e 'const d=JSON.parse(process.argv[1]);if(d.state!=="READY")process.exit(1);' "$STATUS" || fail "Existing candidate is not READY; run jacoctl activate or diagnose the supervisor."
  printf '%s\n' "$STATUS"
  exit 0
fi
PREVIOUS_BRANCH="$(git symbolic-ref --short -q HEAD || true)"
STATE_DIR="$HOME/.local/state/jaco"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREVIOUS_FILE="$STATE_DIR/candidate-previous-$STAMP.sha"
printf '%s\n' "$BEFORE" > "$PREVIOUS_FILE"
info "Previous commit saved in $PREVIOUS_FILE"
info "Switching ${BEFORE:0:12} -> ${TARGET:0:12} (the updater does not rewrite credentials or persisted state)"

SWITCH_STARTED=0
rollback() {
  local exit_code=$?
  trap - ERR INT TERM
  if (( SWITCH_STARTED )); then
    info "Activation/test failed (code $exit_code). Restoring previous source and restarting the previous runtime."
    bash "$CTL" deactivate >/dev/null 2>&1 || true
    if [[ -n "$PREVIOUS_BRANCH" ]]; then
      git switch "$PREVIOUS_BRANCH" >/dev/null 2>&1 || git switch --detach "$BEFORE" || true
    else
      git switch --detach "$BEFORE" || true
    fi
    bash "$CTL" activate --profile full || info 'Rollback activation also needs diagnosis; previous source restored.'
  fi
  exit "$exit_code"
}
trap rollback ERR
trap 'false' INT TERM

# Keep one owner. Stop the old execution tree BEFORE changing code on disk.
SWITCH_STARTED=1
bash "$CTL" deactivate
git -c advice.detachedHead=false switch --detach "$TARGET"

# Negative/contract tests run before starting the new supervisor.
node --experimental-sqlite --test --test-concurrency=1 \
  tests/nova/context-packet.test.mjs \
  tests/nova/replay-semantics.test.mjs \
  tests/nova/effect-evidence.test.mjs \
  tests/nova/living-core-promotion.test.mjs \
  tests/nova/agent-loop.test.mjs \
  tests/nova/native-tools.test.mjs \
  tests/nova/mission.test.mjs

bash "$CTL" activate --profile full
# Refresh Sentinel as well: it survives deactivate, and otherwise stays on old code.
if command -v sv >/dev/null 2>&1; then
  sv restart "$PREFIX/var/service/jaco-sentinel"
fi
STATUS="$(bash "$CTL" status --json)"
node -e 'const d=JSON.parse(process.argv[1]);if(d.state!=="READY")process.exit(1);' "$STATUS"
info "READY on commit $(git rev-parse --short=12 HEAD). Previous source: ${BEFORE:0:12}."
info 'Source rollback is available; automatic database/schema rollback is NOT provided. Inspect persisted state if activation migrated a database.'
trap - ERR INT TERM
printf '%s\n' "$STATUS"
