#!/data/data/com.termux/files/usr/bin/bash
# Restore JACO's runit topology without a global service-daemon restart.
# The latter SIGKILLs runsv, potentially orphaning Workplace/SEER/LiteRT.
set -Eeuo pipefail
ACTION="${1:---check}"
[[ "$ACTION" == --check || "$ACTION" == --apply ]] || exit 2
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SVDIR="${SVDIR:-$PREFIX/var/service}"
JACO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd -- "$JACO_ROOT/.." && pwd)"
PROC_ROOT="${JACO_TEST_PROC_ROOT:-/proc}"
if [[ "$PROC_ROOT" != /proc && "${JACO_TEST_MODE:-0}" != 1 ]]; then
  echo "[JACO] BLOCKED — synthetic proc requires test mode" >&2; exit 42
fi
if [[ "$ACTION" == --apply && "$PROC_ROOT" != /proc ]]; then
  echo "[JACO] BLOCKED — synthetic proc cannot mutate real processes" >&2; exit 42
fi
SERVICES=(jaco-sentinel jaco-core jaco-workplace jaco-nova jaco-ollama jaco-nova-bridge jaco-cdp)
proc_exe(){ readlink "$PROC_ROOT/$1/exe" 2>/dev/null || true; }
proc_cwd(){ readlink "$PROC_ROOT/$1/cwd" 2>/dev/null || true; }
proc_ppid(){ awk '/^PPid:/ {print $2; exit}' "$PROC_ROOT/$1/status" 2>/dev/null || true; }
proc_cmd(){ tr '\0' ' ' < "$PROC_ROOT/$1/cmdline" 2>/dev/null | sed 's/ $//' || true; }
is_service(){
  local item
  for item in "${SERVICES[@]}"; do [[ "$item" == "$1" ]] && return 0; done
  return 1
}
is_master(){
  local cmd
  [[ "$(proc_exe "$1")" == "$PREFIX/bin/runsvdir" ]] || return 1
  cmd="$(proc_cmd "$1")"
  [[ "${cmd##* }" == "$SVDIR" ]]
}
is_orphan_runsv(){
  local cmd
  [[ "$(proc_ppid "$1")" == 1 && "$(proc_exe "$1")" == "$PREFIX/bin/runsv" ]] || return 1
  cmd="$(proc_cmd "$1")"
  is_service "${cmd##* }"
}
is_orphan_worker(){
  local cwd cmd
  [[ "$(proc_ppid "$1")" == 1 ]] || return 1
  cwd="$(proc_cwd "$1")"
  cmd="$(proc_cmd "$1")"
  case "$cwd" in
    "$JACO_ROOT") [[ "$cmd" == *"node --import tsx server.ts"* || "$cmd" == *"tsx server.ts"* || "$cmd" == *"node server.ts"* ]] ;;
    "$JACO_ROOT/gateway") [[ "$cmd" == *"src/sentinel.mjs"* ]] ;;
    "$REPO_ROOT") [[ "$cmd" == *"gateway/src/workplace/workplace-server.mjs"* ||
                     "$cmd" == *"gateway/src/seer-start.mjs"* ||
                     "$cmd" == *"agents/hands-off-agent.mjs"* ||
                     "$cmd" == *"agents/run-desktop-agentos.mjs"* ||
                     ( "$cmd" == *"litert-lm serve"* && "$cmd" == *"--port 9379"* ) ]] ;;
    *) return 1 ;;
  esac
}
count_masters(){
  local p n=0
  for p in "$PROC_ROOT"/[0-9]*; do
    [[ -d "$p" ]] || continue
    is_master "${p##*/}" && n=$((n+1))
  done
  printf '%s' "$n"
}
count_orphans(){
  local p n=0
  for p in "$PROC_ROOT"/[0-9]*; do
    [[ -d "$p" ]] || continue
    is_orphan_runsv "${p##*/}" && n=$((n+1))
  done
  printf '%s' "$n"
}

masters="$(count_masters)"
orphans="$(count_orphans)"
if [[ "$ACTION" == --check ]]; then
  [[ "$masters" == 1 && "$orphans" == 0 ]] && exit 0
  printf '[JACO] DEGRADED — runsvdir=%s orphan-runsv=%s\n' "$masters" "$orphans" >&2
  exit 42
fi
[[ "$masters" -le 1 ]] || { echo "[JACO] BLOCKED — duplicate runsvdir; nothing touched" >&2; exit 42; }
for svc in "${SERVICES[@]}"; do
  [[ -d "$SVDIR/$svc" ]] || { echo "[JACO] BLOCKED — missing $svc; nothing touched" >&2; exit 42; }
done

# Explicit repair may interrupt running missions. Down markers ensure a newly
# spawned runsv never restarts heavy AI services before orphan cleanup.
echo "[JACO] RECOVERY — stopping JACO services (no SSH/other services touched)" >&2
for svc in "${SERVICES[@]}"; do
  touch "$SVDIR/$svc/down"
  sv down "$SVDIR/$svc" >/dev/null 2>&1 || true
done
sleep 3

# Kill only detached runsv instances: exact executable, service name and PPid=1.
for p in "$PROC_ROOT"/[0-9]*; do
  [[ -d "$p" ]] || continue
  pid="${p##*/}"
  if is_orphan_runsv "$pid"; then
    printf '[JACO] RECOVERY — TERM orphan runsv pid=%s\n' "$pid" >&2
    kill -TERM "$pid" 2>/dev/null || true
  fi
done
sleep 3
[[ "$(count_orphans)" == 0 ]] || { echo "[JACO] BLOCKED — orphan runsv survived TERM" >&2; exit 42; }

# A JACO orphan may keep a port or ledger lock. Only PPid=1 workers from
# exactly this checkout are terminated. Never use pkill/killall/SIGKILL.
for pass in 1 2; do
  for p in "$PROC_ROOT"/[0-9]*; do
    [[ -d "$p" ]] || continue
    pid="${p##*/}"
    if is_orphan_worker "$pid"; then
      printf '[JACO] RECOVERY — TERM orphan worker pid=%s\n' "$pid" >&2
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 5
done
for p in "$PROC_ROOT"/[0-9]*; do
  [[ -d "$p" ]] || continue
  if is_orphan_worker "${p##*/}"; then
    echo "[JACO] BLOCKED — owned orphan refused TERM; no duplicate startup" >&2; exit 42
  fi
done

if [[ "$(count_masters)" == 0 ]]; then
  command -v service-daemon >/dev/null 2>&1 || { echo "[JACO] BLOCKED — service-daemon missing" >&2; exit 42; }
  echo "[JACO] RECOVERY — starting missing runsvdir (no global restart)" >&2
  SVDIR="$SVDIR" LOGDIR="${LOGDIR:-$PREFIX/var/log}" service-daemon start >&2 ||
    { echo "[JACO] BLOCKED — failed to start runsvdir" >&2; exit 42; }
fi
for svc in "${SERVICES[@]}"; do
  ready=0
  for ((i=0;i<40;i++)); do
    state="$(sv status "$SVDIR/$svc" 2>&1 || true)"
    if [[ "$state" == run:* || "$state" == down:* ]]; then ready=1; break; fi
    sleep 0.25
  done
  [[ "$ready" == 1 ]] || { printf '[JACO] BLOCKED — no runsv for %s: %s\n' "$svc" "$state" >&2; exit 42; }
done
rm -f "$SVDIR/jaco-sentinel/down"
sv up "$SVDIR/jaco-sentinel" >/dev/null ||
  { echo "[JACO] BLOCKED — Sentinel runsv unavailable" >&2; exit 42; }
echo "[JACO] RECOVERY — JACO controls restored; Core/Workplace remain stopped" >&2
