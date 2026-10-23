#!/bin/sh
# JACO installer. One command, every platform, from a clone of this repository.
#
#   ./install.sh                install what suits this machine, then start it
#   ./install.sh --no-start     install only
#   ./install.sh --doctor       say what is installed and whether it can start
#   ./install.sh --lite         force the portable build (no npm install)
#   ./install.sh --full         force the full development runtime
#   ./install.sh --help
#
# It picks the path for you:
#
#   Android (Termux)   JACO Lite. A prebuilt bundle, so the phone never runs
#                      npm install or a compiler.
#   macOS, Linux       the full runtime through "npm run setup".
#   Windows            see the two commands --help prints.
#
# Nothing here needs administrator rights, and nothing is written outside this
# folder, $HOME/.local and (on Termux) $PREFIX/bin.
#
# Not having the newest Node.js is the one thing that stops an install, so this
# script checks it first and prints the exact command that fixes it.

set -eu

MIN_NODE_LITE=22.5   # lite/start.mjs needs node:sqlite, which arrived in 22.5
MIN_NODE_FULL=24     # the full runtime's engines field
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

MODE=auto
START=1

say()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die()  { printf '\nJACO install stopped: %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
JACO installer

  ./install.sh                install what suits this machine, then start it
  ./install.sh --no-start     install only
  ./install.sh --doctor       say what is installed and whether it can start
  ./install.sh --lite         force the portable build (no npm install)
  ./install.sh --full         force the full development runtime
  ./install.sh --help         this text

On Android, open Termux and run:
  pkg install -y git nodejs-lts && ./install.sh

On Windows, in PowerShell:
  irm https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.ps1 | iex

Without a clone of this repository, on macOS, Linux or Termux:
  curl -fsSL https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.sh | sh

Retired options: --clean, --project-dir, --zip, --lan, --no-open. They belonged
to an older flow that unpacked a ZIP from the Downloads folder. Pass a project
folder and such options to the start command instead; --doctor names it.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --lite)     MODE=lite; shift ;;
    --full)     MODE=full; shift ;;
    --doctor)   MODE=doctor; shift ;;
    --no-start) START=0; shift ;;
    --help|-h)  usage; exit 0 ;;
    --clean|-c|--lan|--no-open)
      die "$1 belonged to the old ZIP installer and no longer does anything. Run ./install.sh --help" ;;
    --project-dir|--zip)
      die "$1 belonged to the old ZIP installer and no longer does anything. Run ./install.sh --help" ;;
    *) die "unknown option $1. Run ./install.sh --help" ;;
  esac
done

# --- which machine is this -----------------------------------------------

TERMUX=0
case "${PREFIX:-}" in */com.termux/*) TERMUX=1 ;; esac
[ -n "${TERMUX_VERSION:-}" ] && TERMUX=1
[ -d /data/data/com.termux/files/usr ] && TERMUX=1

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux)  OS=linux ;;
  Darwin) OS=macos ;;
  MINGW*|MSYS*|CYGWIN*)
    say "This looks like Windows. Use PowerShell instead:"
    say "  irm https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.ps1 | iex"
    exit 1 ;;
  *) OS=unknown ;;
esac
[ "$TERMUX" = 1 ] && OS=android

if [ "$MODE" = auto ]; then
  if [ "$OS" = android ]; then MODE=lite; else MODE=full; fi
fi

# --- Node.js --------------------------------------------------------------

# Compares dotted versions without needing sort -V, which Termux may not have.
node_at_least() {
  have node || return 1
  node -e '
    const need = process.argv[1].split(".").map(Number);
    const got  = process.versions.node.split(".").map(Number);
    for (let i = 0; i < need.length; i++) {
      const a = got[i] || 0, b = need[i] || 0;
      if (a > b) process.exit(0);
      if (a < b) process.exit(1);
    }
    process.exit(0);
  ' "$1" >/dev/null 2>&1
}

node_fix_hint() {
  case "$OS" in
    android) say "  pkg install -y nodejs-lts" ;;
    macos)   say "  brew install node     (or install the LTS from https://nodejs.org)" ;;
    *)       say "  install the current LTS from https://nodejs.org, or with nvm:"
             say "  nvm install --lts && nvm use --lts" ;;
  esac
}

require_node() {
  want=$1
  if ! have node; then
    say "Node.js is not installed. JACO needs $want or newer."
    node_fix_hint
    die "install Node.js and run ./install.sh again"
  fi
  if ! node_at_least "$want"; then
    say "Node.js $(node -v) is installed, but JACO needs $want or newer."
    node_fix_hint
    die "upgrade Node.js and run ./install.sh again"
  fi
  say "Node.js $(node -v) is new enough."
}

# --- doctor ---------------------------------------------------------------

if [ "$MODE" = doctor ]; then
  say "Machine:      $OS"
  if have node; then say "Node.js:      $(node -v)"; else say "Node.js:      not installed"; fi
  if have npm;  then say "npm:          $(npm -v)";  else say "npm:          not installed"; fi
  say "Repository:   $HERE"
  if [ -d "$HERE/node_modules" ]; then say "Root deps:    installed"; else say "Root deps:    missing (run ./install.sh)"; fi
  if [ -f "$HERE/runtime/dist/server.cjs" ]; then say "Server build: present"; else say "Server build: missing (run ./install.sh)"; fi
  if [ -f "$HERE/.env" ]; then say "Local .env:   present"; else say "Local .env:   missing (./install.sh writes a gateway token)"; fi
  say ""
  if [ "$OS" = android ]; then
    say "Start it with:  sh lite/start.sh ~"
    say "A phone should use JACO Lite. The one-line install, without a clone:"
    say "  curl -fsSL https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.sh | sh"
  else
    say "Start it with:  npm run jaco:start"
    say "Status:         npm run jaco:status"
  fi
  exit 0
fi

# --- the portable path (Android, and anyone who asks for it) --------------

install_lite() {
  step "Installing JACO Lite (portable, no npm install on this device)"
  require_node "$MIN_NODE_LITE"

  if [ "$OS" = android ]; then
    for pkg_name in git unzip; do
      have "$pkg_name" || { say "Installing $pkg_name"; pkg install -y "$pkg_name" >/dev/null 2>&1 || say "Could not install $pkg_name automatically; run: pkg install -y $pkg_name"; }
    done
  fi

  # A published build is the fast path: no compiler, no npm install.
  if have curl || have wget; then
    step "Fetching the published build"
    if sh "$HERE/lite/install.sh"; then
      say ""
      say "Installed. Start it with:  jaco-lite"
      say "If the command is not found, add this to your shell profile:"
      if [ "$OS" = android ]; then say "  export PATH=\"\$PREFIX/bin:\$PATH\""; else say "  export PATH=\"\$HOME/.local/bin:\$PATH\""; fi
      return 0
    fi
    say ""
    say "No published build could be fetched. Building one from this clone instead."
    say "That is the slow path: it compiles on this device and needs about 1 GB free."
  fi

  step "Building the portable bundle from source"
  have npm || die "npm is missing, so the bundle cannot be built here. Install Node.js with npm and run ./install.sh again"
  ( cd "$HERE" && npm ci --prefix runtime --no-audit --no-fund ) || die "installing the runtime's dependencies failed. Re-run ./install.sh; if it keeps failing, report the npm error above"
  ( cd "$HERE" && node tools/build-lite.mjs ) || die "building the portable bundle failed. The npm step above succeeded, so report the build error"

  zip=$(ls -1 "$HERE"/build/lite/platforms/jaco-lite-android-*.zip 2>/dev/null | head -1)
  [ -n "$zip" ] || zip=$(ls -1 "$HERE"/build/lite/jaco-lite-*.zip 2>/dev/null | head -1)
  [ -n "$zip" ] || die "the build reported success but produced no zip in build/lite. Report this"
  say ""
  say "Built: $zip"
  say "Install it with:  JACO_LITE_BASE_URL=file://$HERE/build/lite sh lite/install.sh"
  say "Or start it straight from this clone:  sh lite/start.sh ~"
}

# --- the full runtime path (macOS, Linux) ---------------------------------

install_full() {
  step "Installing the full JACO runtime"
  require_node "$MIN_NODE_FULL"
  have npm || die "npm is missing. Install Node.js $MIN_NODE_FULL or newer, which includes npm, and run ./install.sh again"

  step "Running npm run setup"
  # setup.mjs installs the root, runtime and gateway manifests, builds the
  # client and server, and writes a gateway token to .env if none is set. It
  # stops on a failed build rather than reporting success.
  ( cd "$HERE" && npm run setup ) || die "setup failed. The error above names the step; re-running ./install.sh is safe and resumes from a clean state"

  say ""
  say "Installed."
  say "A model is the one thing JACO cannot provide for you. Either:"
  say "  - install Ollama from https://ollama.com and pull a model, or"
  say "  - put a provider key in .env (see .env.example)."
}

case "$MODE" in
  lite) install_lite ;;
  full) install_full ;;
  *)    die "internal error: unknown mode $MODE" ;;
esac

# --- start ----------------------------------------------------------------

if [ "$START" = 1 ]; then
  if [ "$MODE" = full ] && [ -f "$HERE/runtime/dist/server.cjs" ]; then
    step "Starting JACO"
    say "Stop it with Ctrl-C. Next time, just run:  npm run jaco:start"
    cd "$HERE" && exec npm run jaco:start
  fi
  say ""
  say "Run ./install.sh --doctor for the start command for this machine."
else
  say ""
  say "Install only, as asked. ./install.sh --doctor names the start command."
fi
