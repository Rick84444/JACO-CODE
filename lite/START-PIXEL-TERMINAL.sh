#!/usr/bin/env bash
# Run JACO Lite inside the Pixel Linux Terminal (AVF Debian VM).
# No Termux dependencies, no Android system-shell access and no host port exposure.
set -Eeuo pipefail

if [[ -n "${TERMUX_VERSION:-}" || -d /data/data/com.termux/files/usr ]]; then
  printf 'This launcher is for Pixel Terminal (Debian VM), not Termux.\n' >&2
  exit 2
fi

if ! grep -Eqs '^ID=(debian|ubuntu)$' /etc/os-release; then
  printf 'Expected Debian/Ubuntu in the Pixel Linux Terminal VM.\n' >&2
  exit 2
fi

for bin in node git; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf 'Missing %s. Install Debian packages first; Node.js >=22.5 is required.\n' "$bin" >&2
    exit 2
  fi
done

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=5?0:1)'; then
  printf 'JACO Lite requires Node.js 22.5 or newer; found %s.\n' "$(node --version)" >&2
  exit 2
fi

if ! node --experimental-sqlite -e 'require("node:sqlite")' >/dev/null 2>&1; then
  printf 'Node.js on this VM does not expose node:sqlite. Update to a supported Node.js build.\n' >&2
  exit 2
fi

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$DIR/dist/server.cjs" || ! -f "$DIR/dist/index.html" || ! -f "$DIR/release.json" ]]; then
  printf 'JACO Lite release files are missing. Extract the verified complete JACO Lite archive first.\n' >&2
  exit 2
fi

PROJECT="${JACO_PIXEL_PROJECT:-$HOME/jaco-pixel-project}"
mkdir -p "$PROJECT"
printf 'JACO Pixel Terminal (Debian VM)\nProject: %s\n' "$PROJECT"
printf 'After READY, open the exact URL reported by JACO in Pixel Chrome.\n'
printf 'Pixel Chrome localhost forwarding must be tested on this device; only VM loopback is bound.\n'
exec node "$DIR/start.mjs" "$PROJECT" --no-open "$@"
