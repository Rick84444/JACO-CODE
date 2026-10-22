#!/usr/bin/env bash
# Canonical, fail-closed Termux mobile Aura upgrade.
# Usage: bash tools/upgrade-aura-termux.sh
# Intended for an operator-initiated maintenance window: running missions may be interrupted.
set -Eeuo pipefail
IFS=$'\n\t'

say(){ printf '[JACO UPGRADE] %s\n' "$*"; }
fail(){ say "BLOCKED: $*" >&2; exit 1; }
trap 'rc=$?; say "FAILED (exit $rc). No automatic rollback or deletion of state. Read the output before retrying." >&2' ERR

[[ -n "${PREFIX:-}" && "$PREFIX" == */com.termux/files/usr ]] || fail 'This procedure is for Termux only.'
for tool in git node npm sv service-daemon curl readlink pgrep; do command -v "$tool" >/dev/null 2>&1 || fail "Missing command: $tool"; done
ROOT="$(git -C "${JACO_UPGRADE_REPO:-$HOME/JACO-CODE}" rev-parse --show-toplevel)" || fail 'JACO checkout not found'
ORIGIN="$(git -C "$ROOT" remote get-url origin)"
ORIGIN="${ORIGIN,,}"
[[ "$ORIGIN" =~ ^(https://github\.com/|git@github\.com:)rick84444/jaco-code(\.git)?$ ]] || fail 'Unexpected Git origin; refusing to update a different repository.'
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || fail 'Switch to the canonical main branch first.'
[[ -f "$ROOT/runtime/bin/jacoctl" && -d "$ROOT/runtime/termux/services" ]] || fail 'JACO runtime structure missing.'
RUNTIME="$ROOT/runtime"
SVDIR="$PREFIX/var/service"
LOGDIR="$PREFIX/var/log"
PIDFILE="$PREFIX/var/run/service-daemon.pid"
BACKUP_ROOT="$HOME/.jaco/upgrade-backups"
mkdir -p "$BACKUP_ROOT"
BACKUP="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$BACKUP"
say "Repository: $ROOT"
say "Backup folder: $BACKUP"
say 'This operation will briefly stop Core, Workplace and Sentinel; active agent jobs may be interrupted.'

# Preserve the one locally modified tracked lockfile. Never discard other changes.
if [[ -n "$(git -C "$ROOT" diff --cached --name-only)" ]]; then fail 'Staged Git changes found; no changes made.'; fi
while IFS= read -r file; do
  [[ -z "$file" || "$file" == runtime/package-lock.json ]] || fail "Uncommitted tracked file requires manual review: $file"
done < <(git -C "$ROOT" diff --name-only)
if ! git -C "$ROOT" diff --quiet -- runtime/package-lock.json; then
  cp -p "$ROOT/runtime/package-lock.json" "$BACKUP/runtime-package-lock.json"
  git -C "$ROOT" diff --binary -- runtime/package-lock.json > "$BACKUP/runtime-package-lock.patch"
  git -C "$ROOT" stash push -m "JACO Aura upgrade backup $(basename "$BACKUP")" -- runtime/package-lock.json
  say 'Preserved modified runtime/package-lock.json in backup and Git stash; will not reapply stale lock automatically.'
fi
# Intentionally keep untracked files such as .shaders/ in place.

say 'Fetching current main without overwriting local files.'
git -C "$ROOT" fetch --no-tags origin main
git -C "$ROOT" merge --ff-only FETCH_HEAD || fail 'Git fast-forward blocked; existing files preserved.'
TARGET="$(git -C "$ROOT" rev-parse HEAD)"
say "Target commit: $TARGET"
[[ -f "$ROOT/runtime/src/components/CognitiveWorkspace.tsx" ]] || fail 'New Aura workspace source missing.'
grep -R -q 'Mobilnavigation' "$ROOT/runtime/src/components" || fail 'Expected mobile Aura navigation is missing from source.'

say 'Verifying repository-root imports.'
if ! (cd "$ROOT" && node --input-type=module -e "await import('./agents/lib/provider-env-import.mjs')"); then
  say 'Installing missing root dependencies from lockfile.'
  (cd "$ROOT" && npm ci --ignore-scripts --omit=optional --no-audit --no-fund)
  (cd "$ROOT" && node --input-type=module -e "await import('./agents/lib/provider-env-import.mjs')") || fail 'Root module import still fails.'
fi
say 'Building mobile Aura (Core remains untouched until build succeeds).'
(
  cd "$RUNTIME"
  if [[ ! -d node_modules/tsx ]]; then
    npm install --ignore-scripts --no-audit --no-fund
  fi
  node scripts/ensure_rollup_native.mjs
  npm run build:termux
  # Match run_termux_node.sh source hash, so activation cannot rebuild unnecessarily.
  node <<'NODE'
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const files=[];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','dist','.git'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p.replace(/\\/g,'/'));
  }
}
walk('src');
for(const p of ['index.html','vite.config.ts','package.json','package-lock.json']) if(fs.existsSync(p)) files.push(p);
files.sort();
const h=crypto.createHash('sha256');
for(const p of files){h.update(p);h.update('\0');h.update(fs.readFileSync(p));h.update('\0');}
fs.mkdirSync('dist',{recursive:true});
fs.writeFileSync('dist/.jaco-ui-source.sha256',h.digest('hex'));
NODE
)
[[ -s "$RUNTIME/dist/index.html" ]] || fail 'Frontend build did not produce dist/index.html.'
say 'Build completed; preparing supervised process takeover.'

# If the service daemon died, create runit down-markers BEFORE restoring it.
# These are activation policy files, not data/knowledge/ledger files.
for svc in jaco-sentinel jaco-core jaco-workplace jaco-nova jaco-ollama jaco-nova-bridge jaco-cdp; do
  [[ -d "$SVDIR/$svc" ]] || fail "Installed service $svc is missing."
  touch "$SVDIR/$svc/down"
done
if ! pgrep -f "^$PREFIX/bin/runsvdir([[:space:]]|$)" >/dev/null 2>&1; then
  if [[ -s "$PIDFILE" ]]; then
    old_pid="$(cat "$PIDFILE")"
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
      fail "Saved daemon PID $old_pid is still alive; inspect before restarting runit."
    fi
    mv -- "$PIDFILE" "$BACKUP/service-daemon.pid.stale"
  fi
  say 'Starting missing runsvdir; all JACO services initially disabled to prevent duplicate launches.'
  SVDIR="$SVDIR" LOGDIR="$LOGDIR" service-daemon start
fi
for i in $(seq 1 20); do
  if sv status "$SVDIR/jaco-sentinel" 2>&1 | grep -Eq '^(run:|down:)'; then break; fi
  sleep 1
done
for svc in jaco-sentinel jaco-core jaco-workplace; do
  sv status "$SVDIR/$svc" 2>&1 | grep -Eq '^(run:|down:)' || fail "No live runsv control for $svc."
done

# Ask live runsv supervisors to stop their children. This is idempotent.
say 'Stopping previously supervised JACO services.'
for svc in jaco-cdp jaco-nova-bridge jaco-nova jaco-ollama jaco-workplace jaco-core jaco-sentinel; do
  sv down "$SVDIR/$svc" >/dev/null || fail "Cannot stop runsv service $svc"
done

# When runsvdir died earlier, its Node children became orphans. Only terminate
# the three precisely identified, existing-checkout entrypoints. Never use pkill node.
known_pids=()
for proc in /proc/[0-9]*; do
  [[ -r "$proc/cmdline" ]] || continue
  pid="${proc##*/}"
  cwd="$(readlink "$proc/cwd" 2>/dev/null || true)"
  cmd="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
  case "$cwd|$cmd" in
    "$RUNTIME|"*"server.ts"*) known_pids+=("$pid");;
    "$RUNTIME/gateway|"*"src/sentinel.mjs"*) known_pids+=("$pid");;
    "$ROOT|"*"gateway/src/workplace/workplace-server.mjs"*) known_pids+=("$pid");;
  esac
done
if ((${#known_pids[@]})); then
  say "Terminating only confirmed old JACO runtime owners (PIDs: ${known_pids[*]})."
  for pid in "${known_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for i in $(seq 1 25); do
    alive=false
    for pid in "${known_pids[@]}"; do
      if [[ -r "/proc/$pid/cmdline" ]] && [[ -n "$(tr -d '\0' < "/proc/$pid/cmdline" 2>/dev/null)" ]]; then alive=true; fi
    done
    [[ "$alive" == false ]] && break
    sleep 1
  done
  for pid in "${known_pids[@]}"; do
    if [[ -r "/proc/$pid/cmdline" ]] && [[ -n "$(tr -d '\0' < "/proc/$pid/cmdline" 2>/dev/null)" ]]; then
      fail "Old JACO process $pid did not stop after SIGTERM; refusing unsafe double start."
    fi
  done
fi
# Fail closed if ports still belong to an unidentified process.
for port in 2999 3000 2995; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    fail "Port $port still serves health after stopping known owners; refusing duplicate launch."
  fi
done

# Sentinel stays always-on; Core and Workplace are enabled explicitly by jacoctl.
rm -f "$SVDIR/jaco-sentinel/down"

# jacoctl refreshes runit run scripts, checks Core release ownership and
# only starts Workplace after Core is stable.
say 'Starting canonical JACO supervisor (Core -> Workplace -> Nova).'
bash "$RUNTIME/bin/jacoctl" activate
say 'Verifying Core release, runsv status and new UI.'
status="$(bash "$RUNTIME/bin/jacoctl" status)"
printf '%s\n' "$status"
grep -q '\[JACO\] READY' <<< "$status" || fail 'JACO supervisor does not report READY.'
identity="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/runtime/identity)"
node -e 'const fs=require("fs"); const release=JSON.parse(fs.readFileSync(process.argv[1])); const live=JSON.parse(process.argv[2]); if(live.releaseId!==release.releaseId||!live.success)process.exit(1)' "$RUNTIME/CURRENT_RELEASE.json" "$identity" || fail 'Core returned wrong release identity.'
http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/)"
[[ "$http_code" == 200 ]] || fail "Aura GUI endpoint HTTP $http_code"
say "SUCCESS. Aura built from $TARGET, HTTP 200, supervisor READY."
say "Preserved backups: $BACKUP. Untracked files were not modified."