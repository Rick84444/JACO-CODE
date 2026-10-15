#!/bin/sh
# JACO Lite for macOS and Linux: ./start.sh [project-folder] [options]
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5 or newer is required. Install the current LTS from https://nodejs.org and run this again." >&2
  exit 2
fi
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/start.mjs" "$@"
