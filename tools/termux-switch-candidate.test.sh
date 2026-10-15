#!/usr/bin/env bash
# Isolated fake-Termux fault injection; never connects to a device.
set -Eeuo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/termux-switch-candidate.sh"
export NODE_REAL="$(command -v node)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
passed=0
failed=0
case_run(){
  local name="$1" fault="$2" expected="$3"
  local d="$tmp/$name" root="$tmp/$name/repo"
  mkdir -p "$root/runtime/bin" "$d/com.termux/usr/var/service/jaco-core" "$d/com.termux/usr/var/service/jaco-workplace" "$d/bin" "$d/home"
  cat > "$root/runtime/bin/jacoctl" <<'CTL'
#!/bin/bash
printf '%s\n' "$1" >> "$CASE_DIR/events"
if [[ "$1" == deactivate && -f "$CASE_DIR/deactivate_fails" ]]; then exit 9; fi
if [[ "$1" == activate && -f "$CASE_DIR/activate_fails" ]]; then exit 9; fi
if [[ "$1" == status ]]; then printf '{"state":"%s"}\n' "$(cat "$CASE_DIR/status")"; fi
CTL
  cat > "$d/bin/node" <<'NODE'
#!/bin/bash
if [[ "${1:-}" == '-p' ]]; then cat "$CASE_DIR/nodever"; exit 0; fi
if [[ "${1:-}" == '--experimental-sqlite' ]]; then
  echo TEST_RUN >> "$CASE_DIR/events"
  [[ ! -f "$CASE_DIR/test_fails" ]]
  exit $?
fi
exec "$NODE_REAL" "$@"
NODE
  cat > "$d/bin/sv" <<'SV'
#!/bin/bash
echo SV_RESTART >> "$CASE_DIR/events"
SV
  chmod +x "$d/bin/"*
  echo READY > "$d/status"
  echo 24 > "$d/nodever"
  cd "$root"
  git init -q
  git config user.name jaco-test
  git config user.email jaco-test@example.test
  echo original > VERSION
  git add . && git commit -qm original
  local old="$(git rev-parse HEAD)"
  echo candidate > VERSION
  git add . && git commit -qm candidate
  local candidate="$(git rev-parse HEAD)"
  git switch --detach -q "$old"
  case "$fault" in
    success) ;;
    tests) touch "$d/test_fails" ;;
    activate) touch "$d/activate_fails" ;;
    deactivate) touch "$d/deactivate_fails" ;;
    not_ready) echo BLOCKED > "$d/status" ;;
    already_ready) git switch --detach -q "$candidate" ;;
    already_stopped) git switch --detach -q "$candidate"; echo STOPPED > "$d/status" ;;
    dirty) echo dirty >> VERSION ;;
    manifest)
      echo '{}' > package.json
      git add package.json && git commit -qm manifest
      candidate="$(git rev-parse HEAD)"
      git switch --detach -q "$old"
      ;;
    node23) echo 23 > "$d/nodever" ;;
    missing_service) rmdir "$d/com.termux/usr/var/service/jaco-workplace" ;;
    unknown_commit) candidate="$(printf '0%.0s' {1..40})" ;;
  esac
  local status=0
  (
    export PREFIX="$d/com.termux/usr" HOME="$d/home" CASE_DIR="$d" PATH="$d/bin:$PATH"
    bash "$SCRIPT" "$candidate"
  ) > "$d/stdout" 2> "$d/stderr" || status=$?
  local current="$(git rev-parse HEAD)"
  local good=0
  case "$expected" in
    success) [[ $status -eq 0 && "$current" == "$candidate" ]] && good=1 ;;
    unchanged) [[ $status -ne 0 && "$current" == "$old" && ! -f "$d/events" ]] && good=1 ;;
    rollback) [[ $status -ne 0 && "$current" == "$old" && $(grep -c '^activate$' "$d/events" 2>/dev/null || true) -ge 1 ]] && good=1 ;;
    already_ok) [[ $status -eq 0 && "$current" == "$candidate" && $(grep -c '^status$' "$d/events" || true) -eq 1 && $(grep -c '^deactivate$' "$d/events" || true) -eq 0 ]] && good=1 ;;
    already_fail) [[ $status -ne 0 && "$current" == "$candidate" && $(grep -c '^status$' "$d/events" || true) -eq 1 ]] && good=1 ;;
  esac
  if ((good)); then
    printf 'PASS %s (%s)\n' "$name" "$fault"
    passed=$((passed+1))
  else
    printf 'FAIL %s: exit=%s expected=%s current=%s\n' "$name" "$status" "$expected" "$current"
    cat "$d/stderr"
    failed=$((failed+1))
  fi
}
case_run success success success
case_run tests_fail tests rollback
case_run activation_fails activate rollback
case_run deactivation_fails deactivate rollback
case_run final_not_ready not_ready rollback
case_run already_ready already_ready already_ok
case_run already_stopped already_stopped already_fail
case_run dirty_checkout dirty unchanged
case_run package_change manifest unchanged
case_run wrong_node node23 unchanged
case_run missing_service missing_service unchanged
case_run missing_commit unknown_commit unchanged
printf 'Termux fault-matrix: %s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
