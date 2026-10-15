#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PROOF="$ROOT/.jaco/candidate/candidate-proof.json"; ENV_FILE="${JACO_RUNTIME_ENV:-$HOME/.config/jaco/runtime.env}"
[[ -f "$PROOF" ]] || { echo 'CANDIDATE_PROOF_REQUIRED' >&2; exit 20; }; grep -q 'runtime' "$PROOF" || { echo 'CANDIDATE_PROOF_INVALID' >&2; exit 21; }
[[ "${JACO_ALLOW_CANONICAL_PROMOTION:-0}" == "1" ]] || { echo 'CANONICAL_PROMOTION_REQUIRES_EXPLICIT_OPERATOR_OPT_IN: export JACO_ALLOW_CANONICAL_PROMOTION=1' >&2; exit 19; }
command -v sv >/dev/null || { echo 'runit sv command required for canonical activation' >&2; exit 22; }; [[ -f "$ENV_FILE" ]] || { echo "runtime env missing: $ENV_FILE" >&2; exit 23; }
BACKUP="$ENV_FILE.continuum-backup-$(date +%Y%m%d-%H%M%S)"; cp "$ENV_FILE" "$BACKUP"; tmp="$ENV_FILE.tmp.$$"; grep -vE '^(export[[:space:]]+)?JACO_ROOT=' "$ENV_FILE" > "$tmp" || true; printf "\nexport JACO_ROOT='%s'\n" "$ROOT" >> "$tmp"; mv "$tmp" "$ENV_FILE"
rollback(){ echo '[CONTINUUM ACTIVATE] ROLLBACK'; cp "$BACKUP" "$ENV_FILE"; sv restart jaco-core || true; sv restart jaco-sentinel || true; exit 30; }; trap rollback ERR
sv restart jaco-core; sv restart jaco-sentinel; sleep 4
id="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/runtime/identity)"; [[ "$id" == *'runtime'* ]]
s="$(curl -fsS --max-time 5 http://127.0.0.1:2999/health)"; [[ "$s" == *'0.22.0'* ]]
trap - ERR
bash "$ROOT/termux/stop-continuum-candidate.sh" || true
printf '[CONTINUUM ACTIVATE] PASS canonical 0.20 active; rollback backup retained at %s\n' "$BACKUP"
