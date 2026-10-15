#!/data/data/com.termux/files/usr/bin/bash
# Portable JACO Lite on Android / Termux. Uses the exact same bundled IDE as desktop.
set -Eeuo pipefail
command -v pkg >/dev/null 2>&1 || { echo 'Start this launcher from the Termux app.' >&2; exit 1; }
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs-lts
fi
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Keep the user's project and runtime state outside the extracted installation.
PROJECT="${JACO_LITE_PROJECT:-$HOME}"
echo "JACO Lite Android · Project: $PROJECT"
if ! node --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "JACO Lite requires Node.js with node:sqlite. Check 'node --version'; upgrade Termux nodejs-lts if needed." >&2
  exit 2
fi
echo "Open the IDE URL that JACO Lite prints after it reports 'JACO Lite is running' (the port may differ from 3000)."
exec node "$DIR/start.mjs" "$PROJECT" --no-open "$@"
