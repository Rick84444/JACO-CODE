#!/usr/bin/env bash

# ==============================================================================
# JACO Orchestrator — Safe Termux Build Resolver & Runner
#
# Usage:
#   ./run_termux_node.sh
#   ./run_termux_node.sh --build
#   ./run_termux_node.sh --clean
#   ./run_termux_node.sh --lan
#   ./run_termux_node.sh --target dist/server.cjs
# ==============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

DO_BUILD=false
DO_CLEAN=false
LAN_MODE=false
EXPLICIT_TARGET=""

PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"

log() {
    printf "${GREEN}[+]${NC} %s\n" "$*"
}

info() {
    printf "${CYAN}[i]${NC} %s\n" "$*"
}

warn() {
    printf "${YELLOW}[!]${NC} %s\n" "$*" >&2
}

die() {
    printf "${RED}[-] ERROR:${NC} %s\n" "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
JACO Termux Build Resolver & Runner

Options:
  --build             Force npm build before resolving runtime
  --clean             Remove root dist/ and build/ before building
  --lan               Bind to 0.0.0.0 instead of 127.0.0.1
  --target <file>     Run a specific Node.js server entrypoint
  --help              Show this help
EOF
}

while (($# > 0)); do
    case "$1" in
        --build)
            DO_BUILD=true
            shift
            ;;

        --clean)
            DO_CLEAN=true
            DO_BUILD=true
            shift
            ;;

        --lan)
            LAN_MODE=true
            shift
            ;;

        --target)
            (($# >= 2)) || die "--target requires a file path."
            EXPLICIT_TARGET="$2"
            shift 2
            ;;

        --help|-h)
            usage
            exit 0
            ;;

        *)
            die "Unknown argument: $1"
            ;;
    esac
done

trap 'die "Execution failed near line $LINENO."' ERR

printf "${CYAN}"
echo "===================================================="
echo " JACO Termux Build Resolver & Runner"
echo "===================================================="
printf "${NC}"

SCRIPT_DIR="$(
    cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
    pwd
)"

cd "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# Resolve project root
# ------------------------------------------------------------------------------

find_project_roots() {
    find "$1" \
        -maxdepth 4 \
        -type f \
        -name package.json \
        -not -path '*/node_modules/*' \
        -not -path '*/dist/*' \
        -not -path '*/build/*' \
        -not -path '*/.git/*' \
        2>/dev/null
}

if [[ ! -f package.json ]]; then
    info "package.json is not beside the runner. Searching nearby directories."

    PROJECT_FILES=()

    while IFS= read -r package_file; do
        PROJECT_FILES+=("$package_file")
    done < <(find_project_roots "$SCRIPT_DIR")

    if ((${#PROJECT_FILES[@]} == 0)); then
        die "No package.json was found under $SCRIPT_DIR."
    fi

    if ((${#PROJECT_FILES[@]} > 1)); then
        warn "Multiple projects were found:"
        printf '  - %s\n' "${PROJECT_FILES[@]}" >&2
        die "Place the runner in the intended project root."
    fi

    PROJECT_DIR="$(dirname -- "${PROJECT_FILES[0]}")"
    cd "$PROJECT_DIR"
fi

PROJECT_ROOT="$(pwd)"
log "Project root: $PROJECT_ROOT"

# ------------------------------------------------------------------------------
# Environment validation
# ------------------------------------------------------------------------------

command -v node >/dev/null 2>&1 ||
    die "Node.js is missing. In Termux run: pkg install nodejs-lts"

command -v npm >/dev/null 2>&1 ||
    die "npm is missing."

log "Node: $(node --version)"
log "npm:  $(npm --version)"

NODE_PLATFORM="$(node -p "process.platform")"
IS_TERMUX_ANDROID=false
if [[ "$NODE_PLATFORM" == "android" || "${PREFIX:-}" == *"com.termux"* ]]; then
    IS_TERMUX_ANDROID=true
    log "Runtime platform: Termux/Android"
else
    log "Runtime platform: $NODE_PLATFORM"
fi

if [[ ! -d node_modules/tsx ]]; then
    info "Installing JavaScript dependencies (native install scripts disabled)."
    npm install --ignore-scripts --no-audit --no-fund
fi

info "Verifying platform-specific Rollup runtime."
node scripts/ensure_rollup_native.mjs

has_npm_script() {
    local script_name="$1"

    node - "$script_name" <<'NODE'
const fs = require('fs');

const scriptName = process.argv[2];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

process.exit(
  pkg.scripts &&
  typeof pkg.scripts[scriptName] === 'string'
    ? 0
    : 1
);
NODE
}

package_module_type() {
    node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
process.stdout.write(pkg.type === 'module' ? 'module' : 'commonjs');
NODE
}

termux_frontend_source_hash() {
    node <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const roots = ['src'];
const extra = ['index.html','vite.config.ts','package.json','package-lock.json'];
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full.replace(/\\/g, '/'));
  }
}
for (const root of roots) walk(root);
for (const file of extra) if (fs.existsSync(file)) files.push(file);
files.sort();

const hash = crypto.createHash('sha256');
for (const file of files) {
  hash.update(file);
  hash.update('\0');
  hash.update(fs.readFileSync(file));
  hash.update('\0');
}
process.stdout.write(hash.digest('hex'));
NODE
}

build_termux_frontend() {
    info "Building current Aura frontend for Termux."
    npm run build:termux
    mkdir -p dist
    termux_frontend_source_hash > dist/.jaco-ui-source.sha256
}

# ------------------------------------------------------------------------------
# Optional clean/build
# ------------------------------------------------------------------------------

if [[ "$DO_CLEAN" == true ]]; then
    warn "Removing root build outputs: dist/ and build/"
    rm -rf -- dist build
fi

if [[ "$DO_BUILD" == true ]]; then
    if [[ "$IS_TERMUX_ANDROID" == true ]] && has_npm_script build:termux; then
        info "Running Termux build contract (frontend only; server runs from TypeScript source via tsx)."
        build_termux_frontend
    else
        has_npm_script build ||
            die "package.json does not define a build script."

        info "Running project build."
        npm run build
    fi
fi

# ------------------------------------------------------------------------------
# Runtime resolution
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# Termux/Android source runtime
# ------------------------------------------------------------------------------
# Android does not need an esbuild-generated server bundle. Running server.ts
# through tsx avoids platform-native esbuild server bundling and prevents a
# stale dist/server.* artifact from taking precedence over current source.

if [[ "$IS_TERMUX_ANDROID" == true ]]; then
    has_npm_script build:termux ||
        die "Termux requires build:termux for the canonical Aura frontend."

    CURRENT_UI_HASH="$(termux_frontend_source_hash)"
    BUILT_UI_HASH="$(cat dist/.jaco-ui-source.sha256 2>/dev/null || true)"
    if [[ ! -f dist/index.html || "$CURRENT_UI_HASH" != "$BUILT_UI_HASH" ]]; then
        if [[ ! -f dist/index.html ]]; then
            info "Frontend bundle missing."
        else
            info "Aura frontend source changed since the last Termux build."
        fi
        build_termux_frontend
    else
        log "Aura frontend bundle is current."
    fi

    [[ -f server.ts ]] || die "Termux source runtime missing: server.ts"
    [[ -d node_modules/tsx ]] || die "tsx is not installed."

    if [[ "$LAN_MODE" == true ]]; then
        HOST="0.0.0.0"
        warn "LAN mode enabled. The server may be accessible from the local network."
    else
        HOST="127.0.0.1"
    fi

    export NODE_ENV="${NODE_ENV:-production}"
    export PORT
    export HOST

    echo
    info "Launching JACO Termux source runtime."
    echo "    Target: $PROJECT_ROOT/server.ts"
    echo "    Host:   $HOST"
    echo "    Port:   $PORT"
    echo "    Local:  http://127.0.0.1:$PORT"
    echo

    exec node --import tsx server.ts
fi

resolve_server_target() {
    local candidate

    if [[ -n "$EXPLICIT_TARGET" ]]; then
        [[ -f "$EXPLICIT_TARGET" ]] ||
            die "Explicit runtime target does not exist: $EXPLICIT_TARGET"

        printf '%s\n' "$EXPLICIT_TARGET"
        return 0
    fi

    local candidates=(
        "dist/server.cjs"
        "dist/server.mjs"
        "dist/server.js"
        "dist/server/index.cjs"
        "dist/server/index.mjs"
        "dist/server/index.js"
        "build/server.cjs"
        "build/server.mjs"
        "build/server.js"
        "server.cjs"
        "server.mjs"
        "server.js"
    )

    for candidate in "${candidates[@]}"; do
        if [[ -f "$candidate" && -s "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
}

TARGET=""

if TARGET="$(resolve_server_target)"; then
    log "Resolved Node server target: $TARGET"
else
    if [[ "$DO_BUILD" != true ]] && has_npm_script build; then
        info "No server artifact found. Running the declared build script."
        npm run build

        TARGET="$(resolve_server_target || true)"
    fi
fi

# ------------------------------------------------------------------------------
# Prefer explicit server target when available
# ------------------------------------------------------------------------------

if [[ -n "$TARGET" ]]; then
    FILE_SIZE="$(wc -c < "$TARGET")"

    if ((FILE_SIZE < 100)); then
        die "Runtime target is unexpectedly small: $TARGET ($FILE_SIZE bytes)"
    fi

    info "Checking JavaScript syntax."

    if ! node --check "$TARGET"; then
        die "Node syntax validation failed for $TARGET."
    fi

    log "Syntax verified: $TARGET ($FILE_SIZE bytes)"

    if [[ "$LAN_MODE" == true ]]; then
        HOST="0.0.0.0"
        warn "LAN mode enabled. The server may be accessible from the local network."
    else
        HOST="127.0.0.1"
    fi

    export NODE_ENV="${NODE_ENV:-production}"
    export PORT
    export HOST

    echo
    info "Launching JACO Node server."
    echo "    Target: $PROJECT_ROOT/$TARGET"
    echo "    Host:   $HOST"
    echo "    Port:   $PORT"
    echo "    Local:  http://127.0.0.1:$PORT"
    echo

    exec node "$TARGET"
fi

# ------------------------------------------------------------------------------
# Fall back to package scripts
# ------------------------------------------------------------------------------

if [[ "$LAN_MODE" == true ]]; then
    HOST="0.0.0.0"
    warn "LAN mode enabled. The runtime may be accessible from the local network."
else
    HOST="127.0.0.1"
fi

export NODE_ENV="${NODE_ENV:-production}"
export PORT
export HOST

if has_npm_script start; then
    info "No direct server artifact was identified."
    info "Launching the project's npm start contract."

    exec npm run start
fi

if [[ -f dist/index.html ]] && has_npm_script preview; then
    info "Detected a frontend production bundle."
    info "Launching the project's preview contract."

    exec npm run preview -- \
        --host "$HOST" \
        --port "$PORT"
fi

die "No runnable server target, start script, or preview runtime was found."
