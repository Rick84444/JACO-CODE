#!/usr/bin/env bash
# Linux/macOS cloud/dev counterpart of agents/start-all.ps1.
# On Android/Termux this script MUST NOT create a second JACO process tree:
# lifecycle commands delegate to the canonical runit-backed jaco supervisor.
#
#   scripts/cloud-stack.sh install   install npm dependencies (idempotent)
#   scripts/cloud-stack.sh up        install, then start any service not already healthy
#   scripts/cloud-stack.sh status    health of every service and of the VS Code tunnel
#   scripts/cloud-stack.sh tunnel    start a VS Code tunnel kept alive by a watchdog
#   scripts/cloud-stack.sh down      stop the tunnel and the services this script started
#
# Services (same ports as start-all.ps1):
#   2995 Workplace   2994 Remote Bridge   2997 SEER   3000 runtime core
#   2993 JACO Connect MCP (POST /mcp, Bearer gateway token): connections, secrets, accounts
#   9222 headless Chrome (CDP)   4243 Nova browser bridge   2996 CDP MCP facade
#   The last three start when a Chromium binary is found (JACO_CHROME, the
#   preinstalled Playwright Chromium, or chromium/google-chrome on PATH) and
#   JACO_ENABLE_CDP is not 0; without them the IDE shows CDP UNOBSERVED.
#
# The gateway token is generated once into ~/.jaco/gateway.token and written
# into the runtime's gitignored .env, so the MCP launcher picks it up too.
# Existing JACO_GATEWAY_TOKEN / GATEWAY_TOKEN values win over the file.
#
# Tunnel settings: JACO_TUNNEL_NAME (default jaco-cloud, max 20 chars; must be
# unique per account, so give each machine its own), JACO_TUNNEL_PROVIDER
# (default microsoft), JACO_VSCODE_CLI (use this code binary instead of
# downloading the standalone VS Code CLI into ~/.jaco/bin).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$ROOT/scripts/cloud-stack.sh"
RUNTIME="$ROOT/runtime"
STATE="${JACO_STATE_DIR:-$HOME/.jaco}"
LOGS="$STATE/logs"
PIDS="$STATE/pids"
TUNNEL_NAME="${JACO_TUNNEL_NAME:-jaco-cloud}"
mkdir -p "$LOGS" "$PIDS"

say() { echo "[cloud-stack] $*" >&2; }

is_termux() {
  [ -n "${TERMUX_VERSION:-}" ] && return 0
  case "${PREFIX:-}" in
    */com.termux/*) return 0 ;;
  esac
  return 1
}

termux_jaco() {
  if command -v jaco >/dev/null 2>&1; then
    jaco "$@"
    return
  fi
  if [ -f "$RUNTIME/bin/jacoctl" ]; then
    bash "$RUNTIME/bin/jacoctl" "$@"
    return
  fi
  say "Termux canonical supervisor is not installed; run $RUNTIME/termux/install-activation.sh"
  return 127
}

# name|port|health path|working dir|command
SERVICES=(
  "workplace|2995|/health|$ROOT|node --experimental-sqlite gateway/src/workplace/workplace-server.mjs"
  "remote-bridge|2994|/health|$ROOT|node agents/remote-bridge.mjs"
  "seer|2997|/health|$ROOT|node --experimental-sqlite gateway/src/seer-start.mjs"
  "runtime|3000|/api/runtime/identity|$RUNTIME|npx --no-install tsx server.ts"
  "jaco-connect|2993|/health|$ROOT|node runtime/tools/jaco-connect-mcp.mjs --http 2993"
)

# Nova's browser bridge answers /health only with the gateway token; the others ignore it.
healthy() {
  local token="${JACO_GATEWAY_TOKEN:-$(cat "$STATE/gateway.token" 2>/dev/null || true)}"
  curl -fsS -m 2 -o /dev/null -H "authorization: Bearer $token" "http://127.0.0.1:$1$2" 2>/dev/null
}

find_chrome() {
  local c
  for c in "${JACO_CHROME:-}" /opt/pw-browsers/chromium-*/chrome-linux/chrome; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  done
  command -v chromium chromium-browser google-chrome 2>/dev/null | head -n 1
}

if [ "${JACO_ENABLE_CDP:-1}" != "0" ] && CHROME="$(find_chrome)" && [ -n "$CHROME" ]; then
  mkdir -p "$STATE/chrome-profile"
  SERVICES+=(
    "chrome|9222|/json/version|$ROOT|$CHROME --headless=new --no-sandbox --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=$STATE/chrome-profile about:blank"
    "nova-bridge|4243|/health|$ROOT|node agents/nova-bridge.mjs"
    "cdp-bridge|2996|/health|$ROOT|node agents/cdp-bridge.mjs"
  )
fi

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# detach LOG PIDFILE CMD... starts CMD so it outlives this shell, a hook or a
# terminal. setsid (Linux, Termux with util-linux) also makes it a process-group
# leader so stop() can end its children; macOS has no setsid and falls back to nohup.
detach() {
  local log="$1" pidfile="$2"
  shift 2
  if command -v setsid > /dev/null; then
    setsid nohup "$@" > "$log" 2>&1 < /dev/null &
  else
    nohup "$@" > "$log" 2>&1 < /dev/null &
  fi
  echo $! > "$pidfile"
}

# stop NAME PIDFILE
stop() {
  [ -f "$2" ] || return 0
  local pid
  pid="$(cat "$2")"
  if kill -- "-$pid" 2>/dev/null || { pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; }; then
    say "stopped $1"
  fi
  rm -f "$2"
}

install_deps() {
  if is_termux; then
    say "Termux dependency/lifecycle ownership belongs to termux/install-activation.sh + jaco; skipping cloud npm bootstrap"
    return 0
  fi
  for dir in "$ROOT" "$RUNTIME" "$RUNTIME/gateway"; do
    # npm writes node_modules/.package-lock.json on every install; if it is
    # newer than the lockfile the tree is current and a cached container
    # skips the install entirely. ci (not install) keeps lockfiles untouched.
    if [ "$dir/node_modules/.package-lock.json" -nt "$dir/package-lock.json" ]; then
      say "deps current in ${dir#$ROOT/}"
      continue
    fi
    say "npm ci in ${dir#$ROOT/}"
    # Scripts are skipped: none of the three packages needs a postinstall step to run the stack.
    (cd "$dir" && npm ci --no-audit --no-fund --ignore-scripts --loglevel=error >&2)
  done
}

ensure_token() {
  local token="${JACO_GATEWAY_TOKEN:-${GATEWAY_TOKEN:-}}"
  if [ -z "$token" ]; then
    if [ ! -s "$STATE/gateway.token" ]; then
      (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$STATE/gateway.token")
      say "generated gateway token in $STATE/gateway.token"
    fi
    token="$(cat "$STATE/gateway.token")"
  fi
  export JACO_GATEWAY_TOKEN="$token" GATEWAY_TOKEN="$token"
  local env_file="$RUNTIME/.env"
  if ! grep -qs '^JACO_GATEWAY_TOKEN=' "$env_file"; then
    (umask 077; printf 'JACO_GATEWAY_TOKEN=%s\n' "$token" >> "$env_file")
    say "wrote JACO_GATEWAY_TOKEN to ${env_file#$ROOT/} (gitignored)"
  fi
}

up() {
  if is_termux; then
    say "Termux detected: delegating stack activation to canonical jaco supervisor"
    termux_jaco activate
    return
  fi
  install_deps
  ensure_token
  export JACO_WORKSPACE_ROOT="$ROOT" HOST=127.0.0.1 PORT=3000 \
    JACO_WORKPLACE_URL=http://127.0.0.1:2995 JACO_REMOTE_BRIDGE_URL=http://127.0.0.1:2994 \
    SEER_URL=http://127.0.0.1:2997 JACO_RUNTIME_URL=http://127.0.0.1:3000 CDP_PORT=9222
  local failed=0
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port path dir cmd <<< "$entry"
    if healthy "$port" "$path"; then say "$name :$port already healthy"; continue; fi
    # $cmd is split into words on purpose; none of the commands contain quoted arguments.
    # shellcheck disable=SC2086
    (cd "$dir" || exit 1; detach "$LOGS/$name.log" "$PIDS/$name.pid" $cmd)
    # Workplace first: the other services register with it at startup.
    local tries=60
    until healthy "$port" "$path"; do
      tries=$((tries - 1))
      if [ "$tries" -le 0 ]; then say "FAIL $name :$port (see $LOGS/$name.log)"; failed=1; break; fi
      sleep 1
    done
    healthy "$port" "$path" && say "OK   $name :$port"
  done
  return "$failed"
}

# --- VS Code tunnel ---------------------------------------------------------

# Prints the path of a VS Code CLI, downloading the standalone CLI if needed.
# The CLI's stored sign-in only works for the binary path that created it (a
# copy of the same binary elsewhere reads as "not logged in"), so it is kept
# at one fixed path under $STATE.
vscode_cli() {
  if [ -n "${JACO_VSCODE_CLI:-}" ]; then echo "$JACO_VSCODE_CLI"; return; fi
  local cli="$STATE/bin/code"
  if [ -x "$cli" ]; then echo "$cli"; return; fi
  local os arch build
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os/$arch" in
    # Termux is Android/bionic. The Alpine artifact is only a candidate binary;
    # verify it actually executes on this target before treating tunnel support as available.
    Linux/aarch64) build=cli-linux-arm64; is_termux && build=cli-alpine-arm64 ;;
    Linux/x86_64) build=cli-linux-x64 ;;
    Linux/armv7l) build=cli-linux-armhf ;;
    Darwin/arm64) build=cli-darwin-arm64 ;;
    Darwin/x86_64) build=cli-darwin-x64 ;;
    *) say "no VS Code CLI build known for $os/$arch; set JACO_VSCODE_CLI"; return 1 ;;
  esac
  say "downloading VS Code CLI ($build) to $cli"
  mkdir -p "$STATE/bin"
  local archive="$STATE/bin/vscode-cli.download"
  curl -fsSL -o "$archive" "https://update.code.visualstudio.com/latest/$build/stable"
  # Linux builds are .tar.gz, macOS builds are .zip; both contain a single "code" binary.
  if [ "$os" = Darwin ]; then unzip -oq "$archive" -d "$STATE/bin"; else tar -xzf "$archive" -C "$STATE/bin"; fi
  rm -f "$archive"
  if ! "$cli" --version >/dev/null 2>&1; then
    rm -f "$cli"
    say "downloaded VS Code CLI cannot execute on $os/$arch; set JACO_VSCODE_CLI to a compatible binary"
    return 1
  fi
  echo "$cli"
}

tunnel_logged_in() { "$1" tunnel user show 2>/dev/null | grep -q '^logged in'; }
tunnel_connected() { "$1" tunnel status 2>/dev/null | grep -q '"tunnel":"Connected"'; }

# Keeps the tunnel connected: a relay connection reset can end the tunnel
# process without it reconnecting, so this restarts it whenever it is down.
tunnel_watchdog() {
  local cli
  cli="$(vscode_cli)"
  while true; do
    if tunnel_logged_in "$cli" && ! tunnel_connected "$cli"; then
      echo "[$(date -u +%FT%TZ)] tunnel $TUNNEL_NAME not connected, (re)starting"
      "$cli" tunnel kill > /dev/null 2>&1 || true
      sleep 2
      (cd "$ROOT" && detach "$LOGS/tunnel.log" "$PIDS/tunnel.pid" \
        "$cli" tunnel --accept-server-license-terms --name "$TUNNEL_NAME")
      sleep 20
    fi
    sleep 30
  done
}

# tunnel [--if-logged-in]: with the flag, do nothing unless a sign-in already
# exists, so an unattended caller (the SessionStart hook) never starts a login.
tunnel() {
  local cli
  if [ "${1:-}" = --if-logged-in ] && [ -z "${JACO_VSCODE_CLI:-}" ] && [ ! -x "$STATE/bin/code" ]; then
    say "VS Code tunnel skipped: CLI not installed (run: $SELF tunnel)"
    return 0
  fi
  cli="$(vscode_cli)"
  if ! tunnel_logged_in "$cli"; then
    if [ "${1:-}" = --if-logged-in ]; then say "VS Code tunnel skipped: not signed in (run: $SELF tunnel)"; return 0; fi
    if ! alive "$PIDS/tunnel-login.pid"; then
      detach "$LOGS/tunnel-login.log" "$PIDS/tunnel-login.pid" \
        "$cli" tunnel user login --provider "${JACO_TUNNEL_PROVIDER:-microsoft}"
    fi
    local tries=30
    until grep -q 'code' "$LOGS/tunnel-login.log" 2>/dev/null || [ "$tries" -le 0 ]; do tries=$((tries - 1)); sleep 1; done
    say "sign in to start the tunnel:"
    cat "$LOGS/tunnel-login.log" >&2
  fi
  if alive "$PIDS/tunnel-watchdog.pid"; then
    say "tunnel watchdog already running"
  else
    detach "$LOGS/tunnel-watchdog.log" "$PIDS/tunnel-watchdog.pid" "$SELF" _tunnel-watchdog
    say "tunnel watchdog started; it connects the tunnel once signed in"
  fi
  local tries=60
  while tunnel_logged_in "$cli" && ! tunnel_connected "$cli" && [ "$tries" -gt 0 ]; do tries=$((tries - 1)); sleep 1; done
  if tunnel_connected "$cli"; then
    say "OK   tunnel $TUNNEL_NAME: https://vscode.dev/tunnel/$TUNNEL_NAME$ROOT"
  fi
}

tunnel_status() {
  local cli="${JACO_VSCODE_CLI:-$STATE/bin/code}"
  [ -x "$cli" ] || return 0
  if tunnel_connected "$cli"; then echo "OK   tunnel $TUNNEL_NAME"
  elif tunnel_logged_in "$cli"; then echo "DOWN tunnel $TUNNEL_NAME"
  else echo "DOWN tunnel (not signed in)"; fi
}

# ---------------------------------------------------------------------------

status() {
  local failed=0
  if is_termux; then
    termux_jaco status || failed=$?
    tunnel_status
    return "$failed"
  fi
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port path _ <<< "$entry"
    if healthy "$port" "$path"; then echo "OK   $name :$port"; else echo "DOWN $name :$port"; failed=1; fi
  done
  tunnel_status
  return "$failed"
}

stop_tunnel() {
  # The watchdog goes first, or it would restart the tunnel.
  stop tunnel-watchdog "$PIDS/tunnel-watchdog.pid"
  stop tunnel-login "$PIDS/tunnel-login.pid"
  local cli="${JACO_VSCODE_CLI:-$STATE/bin/code}"
  if [ -x "$cli" ] && "$cli" tunnel kill > /dev/null 2>&1; then say "stopped tunnel"; fi
  rm -f "$PIDS/tunnel.pid"
}

down() {
  stop_tunnel
  if is_termux; then
    say "Termux detected: delegating stack shutdown to canonical jaco supervisor"
    termux_jaco deactivate
    return
  fi
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name _ <<< "$entry"
    stop "$name" "$PIDS/$name.pid"
  done
}

case "${1:-up}" in
  install) install_deps ;;
  up) up ;;
  status) status ;;
  tunnel) tunnel "${2:-}" ;;
  down) down ;;
  _tunnel-watchdog) tunnel_watchdog ;;
  *) echo "usage: $0 install|up|status|tunnel|down" >&2; exit 2 ;;
esac
