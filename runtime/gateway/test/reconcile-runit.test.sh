#!/usr/bin/env bash
set -Eeuo pipefail
# Synthetic /proc topology tests: read-only mode must not signal any host PIDs.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/runtime/termux" "$TMP/prefix/bin" "$TMP/proc/101"
cp "$ROOT/termux/reconcile-runit.sh" "$TMP/runtime/termux/reconcile-runit.sh"
CTL="$TMP/runtime/termux/reconcile-runit.sh"
export PREFIX="$TMP/prefix" SVDIR="$TMP/prefix/var/service"
export JACO_TEST_MODE=1 JACO_TEST_PROC_ROOT="$TMP/proc"
ln -s "$PREFIX/bin/runsvdir" "$TMP/proc/101/exe"
printf 'runsvdir\0%s\0' "$SVDIR" > "$TMP/proc/101/cmdline"
printf 'Name:\trunsvdir\nPPid:\t1\n' > "$TMP/proc/101/status"
bash "$CTL" --check
mkdir -p "$TMP/proc/102"
ln -s "$PREFIX/bin/runsv" "$TMP/proc/102/exe"
printf 'runsv\0jaco-workplace\0' > "$TMP/proc/102/cmdline"
printf 'Name:\trunsv\nPPid:\t1\n' > "$TMP/proc/102/status"
set +e
bash "$CTL" --check >/dev/null 2>"$TMP/error"
rc=$?
set -e
[[ "$rc" == 42 ]]
grep -q 'orphan-runsv=1' "$TMP/error"
# Different service name must not count as a JACO process.
printf 'runsv\0sshd\0' > "$TMP/proc/102/cmdline"
bash "$CTL" --check
# A detached JACO runsV under a live runsvdir must not be misclassified.
printf 'runsv\0jaco-core\0' > "$TMP/proc/102/cmdline"
printf 'Name:\trunsv\nPPid:\t101\n' > "$TMP/proc/102/status"
bash "$CTL" --check
# Two supervisors are not safe: fail closed.
mkdir -p "$TMP/proc/103"
ln -s "$PREFIX/bin/runsvdir" "$TMP/proc/103/exe"
printf 'runsvdir\0%s\0' "$SVDIR" > "$TMP/proc/103/cmdline"
printf 'Name:\trunsvdir\nPPid:\t1\n' > "$TMP/proc/103/status"
set +e
bash "$CTL" --check > /dev/null 2>&1
rc=$?
set -e
[[ "$rc" == 42 ]]
# Never allow synthetic proc paths to trigger real process mutations.
set +e
bash "$CTL" --apply >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" == 42 ]]
! grep -Eq 'service-daemon[[:space:]]+restart|pkill|killall|kill -KILL' "$CTL"
bash -n "$CTL"
echo 'PASS reconciler: ownership detection, unrelated isolation, fail-closed no-global-restart'
