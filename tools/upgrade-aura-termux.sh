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
for tool in git node npm sv curl readlink; do command -v "$tool" >/dev/null 2>&1 || fail "Missing command: $tool"; done
ROOT="$(git -C "${JACO_UPGRADE_REPO:-$HOME/JACO-CODE}" rev-parse --show-toplevel)" || fail 'JACO checkout not found'
ORIGIN="$(git -C "$ROOT" remote get-url origin)"
ORIGIN="${ORIGIN,,}"
[[ "$ORIGIN" =~ ^(https://github\.com/|git@github\.com:)rick84444/jaco-code(\.git)?$ ]] || fail 'Unexpected Git origin; refusing to update a different repository.'
[[ -f "$ROOT/runtime/bin/jacoctl" && -d "$ROOT/runtime/termux/services" ]] || fail 'JACO runtime structure missing.'
RUNTIME="$ROOT/runtime"
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

# The checkout may be on a detached HEAD or a temporary branch. Promote to
# canonical main only when the current commit and local main are ancestors of
# the fetched main. This preserves unique branch commits for manual review.
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
if [[ "$CURRENT_BRANCH" != main ]]; then
  git -C "$ROOT" merge-base --is-ancestor HEAD FETCH_HEAD ||
    fail 'Current branch contains commits outside fetched main; cannot switch automatically.'
  if git -C "$ROOT" show-ref --quiet --verify refs/heads/main; then
    if ! git -C "$ROOT" merge-base --is-ancestor main FETCH_HEAD; then
      # Preserve divergent local main history as a Git tag before updating
      # its branch pointer. This avoids accumulating deployment branches.
      OLD_MAIN="$(git -C "$ROOT" rev-parse --verify refs/heads/main)"
      SAVED_MAIN_TAG="jaco-main-before-aura-$(date -u +%Y%m%dT%H%M%S%N)"
      git -C "$ROOT" tag "$SAVED_MAIN_TAG" "$OLD_MAIN" ||
        fail 'Could not preserve the divergent local main commit.'
      [[ "$(git -C "$ROOT" rev-parse --verify "refs/tags/$SAVED_MAIN_TAG")" == "$OLD_MAIN" ]] ||
        fail 'Preserved main tag does not resolve to the original commit.'
      printf 'Original local main: %s\nPreserved as tag: %s\nRemote target: %s\n' \
        "$OLD_MAIN" "$SAVED_MAIN_TAG" "$(git -C "$ROOT" rev-parse FETCH_HEAD)" > "$BACKUP/preserved-local-main.txt"
      say "Preserved local main commit $OLD_MAIN as Git tag $SAVED_MAIN_TAG."
      # Refuse if local main is checked out by another worktree. No hard
      # reset or working-tree cleanup is performed.
      git -C "$ROOT" branch -f main FETCH_HEAD ||
        fail "Cannot update local main; its previous state remains available as $SAVED_MAIN_TAG."
    fi
    git -C "$ROOT" switch main ||
      fail 'Could not switch to main; inspect checkout and worktrees without resetting.'
  else
    git -C "$ROOT" switch -c main --track origin/main ||
      fail 'Could not create main; inspect checkout without resetting.'
  fi
  say "Switched to canonical main from ${CURRENT_BRANCH:-detached HEAD}."
fi
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

# A single lifecycle owner must handle all managed services. The previous
# duplicate shutdown path left Sentinel/Core/Workplace down when an orphan
# answered on :2995; do not create persistent down-markers here.
# jacoctl handles known orphan checkouts and refuses unknown port owners.
say 'Restarting the canonical JACO supervisor (Sentinel -> Core -> Workplace -> Nova).'
bash "$RUNTIME/bin/jacoctl" restart
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