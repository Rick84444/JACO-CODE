#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SVDIR="$PREFIX/var/service"
BOOT=false
[[ "${1:-}" == '--boot' ]] && BOOT=true

command -v pkg >/dev/null || { echo 'Run inside Termux.' >&2; exit 1; }
pkg install -y nodejs-lts curl termux-services

# Core and Workplace import modules from the repository root (agents/ and
# gateway/). runtime/node_modules does not satisfy those sibling imports.
# Restore the locked root dependency tree before replacing any runit services,
# so a missing dotenv cannot turn Core activation into a restart storm.
REPO_ROOT="$(cd -- "$ROOT/.." && pwd)"
[[ -f "$REPO_ROOT/package-lock.json" ]] || {
  echo "JACO_ROOT_LOCKFILE_MISSING: expected $REPO_ROOT/package-lock.json" >&2
  exit 42
}
if ! (cd "$REPO_ROOT" && node -e "require.resolve('dotenv')" >/dev/null 2>&1); then
  printf '[JACO] Repairing missing repository-root dependencies before activation...\n'
  (cd "$REPO_ROOT" && npm ci --ignore-scripts --omit=optional --no-audit --no-fund)
fi
(cd "$REPO_ROOT" && node --input-type=module -e "await import('./agents/lib/provider-env-import.mjs')") || {
  echo "JACO_ROOT_IMPORT_FAILED: repository root dependencies are incomplete." >&2
  exit 43
}

mkdir -p "$HOME/.config/jaco" "$HOME/.local/bin" "$SVDIR"
ENV_FILE="$HOME/.config/jaco/runtime.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

ensure_export() {
  local key="$1" value="$2"
  grep -q "^export ${key}=" "$ENV_FILE" 2>/dev/null ||
    printf "export %s='%s'\n" "$key" "$value" >> "$ENV_FILE"
}

set_export() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^export ${key}=" "$ENV_FILE" > "$tmp" || true
  printf "export %s='%s'\n" "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# JACO_ROOT is topology, not a user preference. Always point it at the runtime
# that is actually running this installer so stale downloads/old checkout paths
# cannot survive upgrades.
set_export JACO_ROOT "$ROOT"
ensure_export JACO_GATEWAY_HOST "127.0.0.1"
ensure_export JACO_GATEWAY_PORT "2999"
ensure_export JACO_GATEWAY_MODE "loopback"
ensure_export JACO_BASE_URL "http://127.0.0.1:3000"
ensure_export JACO_SENTINEL_URL "http://127.0.0.1:2999"
ensure_export JACO_CORE_URL "http://127.0.0.1:3000"
ensure_export JACO_RUNTIME_URL "http://127.0.0.1:3000"
ensure_export SEER_URL "http://127.0.0.1:2997"
ensure_export JACO_WORKPLACE_URL "http://127.0.0.1:2995"
# New installs run one operator agent by default; explicit existing settings win.
# The mode-600 runtime env remains the only persisted profile source.
ensure_export JACO_AURA_LEAN "1"
ensure_export JACO_WORKPLACE_REQUIRED "1"
ensure_export JACO_WORKPLACE_SUPERVISE_MODEL "1"
ensure_export JACO_WORKPLACE_SUPERVISE_SEER "1"
ensure_export JACO_WORKPLACE_SUPERVISE_NOVA "1"
ensure_export JACO_LEVEL5_AUTONOMY "1"
ensure_export JACO_ALLOW_SHELL_TASKS "1"
ensure_export JACO_REMOTE_ALLOW_MUTATIONS "1"
ensure_export JACO_GITHUB_BOOTSTRAP_ENABLE "1"
ensure_export JACO_GITHUB_BOOTSTRAP_REPO "Rick84444/jaco-code"
ensure_export JACO_GITHUB_BOOTSTRAP_ACTOR "Rick84444"
ensure_export JACO_GITHUB_BOOTSTRAP_POLL_MS "15000"


# Preserve any existing credential. If none exists, generate one locally and
# persist only to the mode-600 runtime env. Never print the credential.
set +u
# shellcheck disable=SC1090
. "$ENV_FILE"
set -u
SHARED_TOKEN="${JACO_GATEWAY_TOKEN:-${GATEWAY_TOKEN:-${SEER_TOKEN:-}}}"
if [[ -z "$SHARED_TOKEN" ]]; then
  SHARED_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
fi
if ! grep -q '^export JACO_GATEWAY_TOKEN=' "$ENV_FILE"; then
  printf "export JACO_GATEWAY_TOKEN='%s'\n" "$SHARED_TOKEN" >> "$ENV_FILE"
fi

install_entrypoint() {
  local name="$1" interpreter="$2" target="$3" dir dest
  for dir in "$HOME/.local/bin" "$PREFIX/bin"; do
    mkdir -p "$dir"
    dest="$dir/$name"
    rm -f "$dest"
    cat > "$dest" <<EOF
#!$interpreter
exec "$interpreter" "$target" "\$@"
EOF
    chmod +x "$dest"
  done
}

# Install executable wrappers instead of chmod/symlinks into the Git checkout.
# This keeps the repository clean on Termux even when Git tracks script modes as non-executable.
install_entrypoint jaco "$PREFIX/bin/sh" "$ROOT/bin/jaco"
install_entrypoint jacoctl "$PREFIX/bin/bash" "$ROOT/bin/jacoctl"
install_entrypoint jaco-tunnel "$PREFIX/bin/bash" "$ROOT/bin/jaco-tunnel"

for svc in jaco-sentinel jaco-core jaco-workplace jaco-nova jaco-ollama jaco-nova-bridge jaco-cdp; do
  rm -rf "$SVDIR/$svc"
  cp -a "$ROOT/termux/services/$svc" "$SVDIR/$svc"
  mkdir -p "$SVDIR/$svc/log"
  rm -f "$SVDIR/$svc/log/run"
  ln -s "$PREFIX/share/termux-services/svlogger" "$SVDIR/$svc/log/run"
  chmod +x "$SVDIR/$svc/run"
done

# termux-services uses a runsvdir daemon. Ensure it is alive before lifecycle
# commands rely on supervise/ok for newly installed JACO services.
LOGDIR="$PREFIX/var/log"
mkdir -p "$LOGDIR/sv"
if ! pgrep -f "runsvdir.*$SVDIR" >/dev/null 2>&1; then
  SVDIR="$SVDIR" LOGDIR="$LOGDIR" "$PREFIX/bin/service-daemon" start >/dev/null 2>&1 || true
fi

for svc in jaco-sentinel jaco-core jaco-workplace jaco-nova jaco-ollama jaco-nova-bridge jaco-cdp; do
  for _ in $(seq 1 40); do
    [[ -e "$SVDIR/$svc/supervise/ok" ]] && break
    sleep 0.25
  done
  [[ -e "$SVDIR/$svc/supervise/ok" ]] ||
    { echo "termux-services is not supervising $svc; restart the Termux shell or service-daemon." >&2; exit 32; }
done

# Sentinel survives as the bootstrap plane. Workplace owns Nova. Core and Workplace
# stay down until activation; legacy jaco-nova remains installed but disabled.
rm -f "$SVDIR/jaco-sentinel/down"
touch "$SVDIR/jaco-core/down"
touch "$SVDIR/jaco-workplace/down"
touch "$SVDIR/jaco-nova/down"
touch "$SVDIR/jaco-ollama/down"
touch "$SVDIR/jaco-nova-bridge/down"
touch "$SVDIR/jaco-cdp/down"

printf '[JACO] Installing official MCP v2 gateway dependencies...\n'
(cd "$ROOT/gateway" && npm install --omit=dev)

if [[ "$BOOT" == true ]]; then
  mkdir -p "$HOME/.termux/boot"
  for script in 00-jaco-sentinel 10-jaco-auto-activate; do
    cp "$ROOT/termux/boot/$script" "$HOME/.termux/boot/$script"
    chmod +x "$HOME/.termux/boot/$script"
  done
  printf '[JACO] Termux:Boot scripts installed. Termux:Boot app must be installed/opened once.\n'
  printf '[JACO] To activate the full stack at every boot: add  export JACO_AUTO_ACTIVATE=1  to %s\n' "$ENV_FILE"
fi

printf '[JACO] Activation layer installed and termux-services supervision verified.\n'
printf '[JACO] Run: jaco activate  (or: jacoctl activate)\n'
