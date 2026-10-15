#!/usr/bin/env bash

# ==============================================================================
# JACO AI Studio — Safe Android / Linux / macOS Installer
#
# Usage:
#   ./install.sh
#   ./install.sh --clean
#   ./install.sh --project-dir /path/to/project
#   ./install.sh --zip /path/to/export.zip
#   ./install.sh --lan
#   ./install.sh --no-open
# ==============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

DO_CLEAN=false
OPEN_BROWSER=true
LAN_MODE=false
PROJECT_DIR=""
ZIP_FILE=""

TARGET_PORT="${PORT:-3000}"
INSTALL_ROOT="${JACO_INSTALL_DIR:-$HOME/jaco-ai-studio}"

log() {
    printf '[+] %s\n' "$*"
}

warn() {
    printf '[!] %s\n' "$*" >&2
}

die() {
    printf '[-] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
JACO AI Studio Installer

Options:
  --clean, -c             Remove root node_modules/ and dist/ before install
  --project-dir <path>    Use an existing project directory
  --zip <path>            Extract a specific AI Studio ZIP
  --lan                   Bind server to 0.0.0.0 instead of 127.0.0.1
  --no-open               Do not open the browser automatically
  --help, -h              Show this help
EOF
}

while (($# > 0)); do
    case "$1" in
        --clean|-c|clean)
            DO_CLEAN=true
            shift
            ;;

        --project-dir)
            (($# >= 2)) || die "--project-dir requires a path."
            PROJECT_DIR="$2"
            shift 2
            ;;

        --zip)
            (($# >= 2)) || die "--zip requires a ZIP path."
            ZIP_FILE="$2"
            shift 2
            ;;

        --lan)
            LAN_MODE=true
            shift
            ;;

        --no-open)
            OPEN_BROWSER=false
            shift
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

case "${CLEAN:-}" in
    true|TRUE|1|yes|YES)
        DO_CLEAN=true
        ;;
esac

trap 'die "Installer failed near line $LINENO."' ERR

echo "----------------------------------------------------------------------"
echo " JACO AI Studio — Safe On-Device / Server Installation"
echo "----------------------------------------------------------------------"

# ------------------------------------------------------------------------------
# Environment detection
# ------------------------------------------------------------------------------

IS_TERMUX=false

if [[ -n "${TERMUX_VERSION:-}" ]] ||
   [[ -d "/data/data/com.termux/files/usr" ]]; then
    IS_TERMUX=true
    log "Detected Android Termux environment."
else
    log "Detected standard Unix environment."
fi

# ------------------------------------------------------------------------------
# Dependencies
# ------------------------------------------------------------------------------

if [[ "$IS_TERMUX" == true ]]; then
    if [[ ! -d "$HOME/storage" ]] &&
       command -v termux-setup-storage >/dev/null 2>&1; then
        log "Requesting access to Android shared storage."
        termux-setup-storage || warn "Storage permission was not completed."
    fi

    MISSING_TERMUX_PACKAGES=()

    command -v node >/dev/null 2>&1 ||
        MISSING_TERMUX_PACKAGES+=("nodejs-lts")

    command -v git >/dev/null 2>&1 ||
        MISSING_TERMUX_PACKAGES+=("git")

    command -v curl >/dev/null 2>&1 ||
        MISSING_TERMUX_PACKAGES+=("curl")

    command -v unzip >/dev/null 2>&1 ||
        MISSING_TERMUX_PACKAGES+=("unzip")

    if ((${#MISSING_TERMUX_PACKAGES[@]} > 0)); then
        log "Installing required Termux packages: ${MISSING_TERMUX_PACKAGES[*]}"
        pkg update -y
        pkg install -y "${MISSING_TERMUX_PACKAGES[@]}"
    fi
fi

command -v node >/dev/null 2>&1 ||
    die "Node.js is not installed."

command -v npm >/dev/null 2>&1 ||
    die "npm is not installed."

command -v unzip >/dev/null 2>&1 ||
    die "unzip is not installed."

log "Node version: $(node --version)"
log "npm version:  $(npm --version)"

# ------------------------------------------------------------------------------
# Project discovery
# ------------------------------------------------------------------------------

find_project_root() {
    local search_root="$1"
    local candidate
    local candidates=()

    while IFS= read -r candidate; do
        candidates+=("$candidate")
    done < <(
        find "$search_root" \
            -mindepth 1 \
            -maxdepth 4 \
            -type f \
            -name package.json \
            -not -path '*/node_modules/*' \
            -not -path '*/dist/*' \
            -not -path '*/.git/*' \
            2>/dev/null
    )

    if ((${#candidates[@]} == 1)); then
        dirname "${candidates[0]}"
        return 0
    fi

    if ((${#candidates[@]} > 1)); then
        warn "Multiple package.json files found:"
        printf '    %s\n' "${candidates[@]}" >&2
        return 2
    fi

    return 1
}

validate_zip_entries() {
    local zip_path="$1"
    local entry

    while IFS= read -r entry; do
        case "$entry" in
            /*|../*|*/../*|*/..)
                die "Unsafe ZIP entry detected: $entry"
                ;;
        esac
    done < <(unzip -Z1 "$zip_path")
}

zip_contains_project() {
    local zip_path="$1"

    unzip -Z1 "$zip_path" |
        grep -Eq '(^|/)package\.json$'
}

find_latest_project_zip() {
    local download_dir="$1"
    local zip_path
    local newest_zip=""
    local newest_time=0
    local modified_time

    while IFS= read -r -d '' zip_path; do
        if ! zip_contains_project "$zip_path"; then
            continue
        fi

        modified_time="$(
            stat -c '%Y' "$zip_path" 2>/dev/null ||
            stat -f '%m' "$zip_path" 2>/dev/null ||
            printf '0'
        )"

        if ((modified_time > newest_time)); then
            newest_time="$modified_time"
            newest_zip="$zip_path"
        fi
    done < <(
        find "$download_dir" \
            -maxdepth 1 \
            -type f \
            -iname '*.zip' \
            -print0 \
            2>/dev/null
    )

    [[ -n "$newest_zip" ]] || return 1
    printf '%s\n' "$newest_zip"
}

resolve_download_directory() {
    local candidate

    for candidate in \
        "$HOME/storage/downloads" \
        "/sdcard/Download" \
        "$HOME/Downloads"
    do
        if [[ -d "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
}

if [[ -n "$PROJECT_DIR" ]]; then
    [[ -d "$PROJECT_DIR" ]] ||
        die "Project directory does not exist: $PROJECT_DIR"

    cd "$PROJECT_DIR"

elif [[ -f package.json ]]; then
    log "Using current directory as project root."

else
    DISCOVERED_ROOT=""

    if DISCOVERED_ROOT="$(find_project_root ".")"; then
        log "Found project root: $DISCOVERED_ROOT"
        cd "$DISCOVERED_ROOT"

    else
        if [[ -z "$ZIP_FILE" && "$IS_TERMUX" == true ]]; then
            DOWNLOAD_DIR=""

            if DOWNLOAD_DIR="$(resolve_download_directory)"; then
                log "Searching for an AI Studio ZIP in: $DOWNLOAD_DIR"

                if ZIP_FILE="$(find_latest_project_zip "$DOWNLOAD_DIR")"; then
                    log "Selected project ZIP: $ZIP_FILE"
                fi
            fi
        fi

        [[ -n "$ZIP_FILE" ]] ||
            die "No package.json or suitable project ZIP was found."

        [[ -f "$ZIP_FILE" ]] ||
            die "ZIP file does not exist: $ZIP_FILE"

        zip_contains_project "$ZIP_FILE" ||
            die "ZIP does not contain package.json."

        validate_zip_entries "$ZIP_FILE"

        if [[ -e "$INSTALL_ROOT" && ! -f "$INSTALL_ROOT/package.json" ]]; then
            if [[ -n "$(ls -A "$INSTALL_ROOT" 2>/dev/null || true)" ]]; then
                die "Install directory is not empty: $INSTALL_ROOT"
            fi
        fi

        mkdir -p "$INSTALL_ROOT"

        log "Extracting project into: $INSTALL_ROOT"
        unzip -q -o "$ZIP_FILE" -d "$INSTALL_ROOT"

        if [[ -f "$INSTALL_ROOT/package.json" ]]; then
            cd "$INSTALL_ROOT"
        else
            EXTRACTED_ROOT=""

            if EXTRACTED_ROOT="$(find_project_root "$INSTALL_ROOT")"; then
                cd "$EXTRACTED_ROOT"
            else
                die "Could not identify one unambiguous project root after extraction."
            fi
        fi
    fi
fi

[[ -f package.json ]] ||
    die "package.json is missing from resolved project root: $(pwd)"

PROJECT_ROOT="$(pwd)"
FULL_STACK=false
RUNTIME_DIR=""
if [[ -f agents/lib/local-stack.mjs ]]; then
    FULL_STACK=true
    [[ "$(node -p process.platform)" == win32 ]] || die "The full-stack launcher currently supports Windows. Unix/Termux full-stack installation is not release verified; no agent-only fallback will be started."

fi
log "Resolved project root: $PROJECT_ROOT"

# ------------------------------------------------------------------------------
# Package scripts
# ------------------------------------------------------------------------------

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

# ------------------------------------------------------------------------------
# Clean and dependency installation
# ------------------------------------------------------------------------------

if [[ "$DO_CLEAN" == true ]]; then
    log "Removing root build artifacts."
    rm -rf -- node_modules dist
fi

if [[ -f package-lock.json ]]; then
    log "Installing locked dependencies with npm ci."
    npm ci --no-audit --no-fund
else
    warn "package-lock.json is missing; dependency versions may not be reproducible."
    log "Installing dependencies with npm install."
    npm install --no-audit --no-fund
fi

# ------------------------------------------------------------------------------
# Build
# ------------------------------------------------------------------------------

if [[ "$FULL_STACK" == true ]]; then
    RUNTIME_DIR="$(node --input-type=module -e 'import {configuration} from "./agents/lib/local-stack.mjs";console.log(configuration().runtime)')"
    [[ -f "$RUNTIME_DIR/package-lock.json" ]] || die "Locked runtime package is missing: $RUNTIME_DIR"
    [[ "$LAN_MODE" == false ]] || die "Full-stack local startup binds loopback; configure authenticated remote access separately."
    log "Installing and building the canonical runtime."
    (cd "$RUNTIME_DIR" && npm ci --no-audit --no-fund && npm run build)
elif has_npm_script build; then
    log "Building current project source."
    npm run build
else
    warn "No build script exists in package.json; skipping build."
fi

# ------------------------------------------------------------------------------
# Runtime configuration
# ------------------------------------------------------------------------------

if [[ "$LAN_MODE" == true ]]; then
    TARGET_HOST="0.0.0.0"
    warn "LAN mode enabled. The service may be reachable by other devices."
else
    TARGET_HOST="127.0.0.1"
fi

export PORT="$TARGET_PORT"
export HOST="$TARGET_HOST"

LOCAL_URL="http://127.0.0.1:$TARGET_PORT"

echo "----------------------------------------------------------------------"
echo " Installation and build completed"
echo " Project: $PROJECT_ROOT"
echo " Host:    $TARGET_HOST"
echo " Port:    $TARGET_PORT"
echo " Local:   $LOCAL_URL"
echo "----------------------------------------------------------------------"

# ------------------------------------------------------------------------------
# Browser
# ------------------------------------------------------------------------------

if [[ "$OPEN_BROWSER" == true && "$FULL_STACK" == false ]]; then
    if command -v termux-open-url >/dev/null 2>&1; then
        termux-open-url "$LOCAL_URL" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$LOCAL_URL" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "$LOCAL_URL" >/dev/null 2>&1 &
    fi
fi

# ------------------------------------------------------------------------------
# Start server
# ------------------------------------------------------------------------------

if [[ "$FULL_STACK" == true ]]; then
    log "Starting the canonical JACO stack."
    if [[ "$OPEN_BROWSER" == true ]]; then
        exec node agents/lib/local-stack.mjs --open
    else
        exec node agents/lib/local-stack.mjs
    fi
elif [[ -f dist/server.cjs ]]; then
    log "Starting bundled Node server."
    exec node dist/server.cjs

elif has_npm_script start; then
    log "Starting npm start script."
    exec npm run start

elif has_npm_script preview; then
    log "Starting production preview server."
    exec npm run preview -- \
        --host "$TARGET_HOST" \
        --port "$TARGET_PORT"

elif has_npm_script dev; then
    warn "No production start or preview script exists."
    warn "Falling back to development server."

    exec npm run dev -- \
        --host "$TARGET_HOST" \
        --port "$TARGET_PORT"

else
    die "No server.cjs, start, preview, or dev runtime was found."
fi
