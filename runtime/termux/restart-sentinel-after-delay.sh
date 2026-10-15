#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
delay="${1:-3}"
[[ "$delay" =~ ^[0-9]+$ ]] || exit 2
(( delay >= 1 && delay <= 30 )) || exit 2
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
sleep "$delay"
exec "$PREFIX/bin/sv" restart "$PREFIX/var/service/jaco-sentinel"
