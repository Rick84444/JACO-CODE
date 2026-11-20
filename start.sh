#!/usr/bin/env bash
# Start the canonical JACO stack from any working directory.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 24+ is required. Install Node, then run npm run setup." >&2
    exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
    echo "Node.js 24+ is required. Current version: $(node --version)" >&2
    exit 1
fi
if [[ ! -d node_modules || ! -d runtime/node_modules ]]; then
    echo "JACO dependencies missing. Run npm run setup from $ROOT before starting." >&2
    exit 1
fi
# Do not run a legacy installer, spawn a second agent, or remove state locks.
args=()
open=true
for arg in "$@"; do
    case "$arg" in
        --no-open|--preflight|--status) open=false ;;
    esac
    [[ "$arg" == --no-open ]] || args+=("$arg")
done
if [[ "$open" == true ]]; then args+=(--open); fi
exec node agents/lib/local-stack.mjs "${args[@]}"
