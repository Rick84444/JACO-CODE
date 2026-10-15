#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/**
 * Kvalitetsgrind för externa leveranser (t.ex. innan en JACO-agent får
 * markera en betald a2acolony/a2amarket-uppgift som slutförd).
 *
 * Kör det vendorade Python-verktyget tools/delivery_gate (från
 * jaco_agency_2.zip) mot en källfil/mapp + valfria kommandon som MÅSTE
 * lyckas, och sparar det verkliga, deterministiska utfallet som riktig
 * Continuum-evidence - inte en påstådd status, ett faktiskt exekverat
 * kommandos exit-kod.
 *
 * Exit-koder speglar delivery_gate självt:
 *   0 = PASS       (evidence sparad, verified:true, kan gå vidare)
 *   1 = BLOCKED     (stubbar/ogrundade siffror hittade - stoppa leveransen)
 *   2 = UNPROVEN    (inget kommando kördes - inget bevisat)
 *
 * Användning:
 *   node scripts/continuum/delivery-gate-check.mjs <källa> \
 *     --run "<testkommando>" [--run "<fler>"] \
 *     [--continuum http://127.0.0.1:3020] [--actor <agentId>]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const source = args.find(a => !a.startsWith('--'));
const runCmds = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--run') runCmds.push(args[++i]);
const continuumUrl = (args.includes('--continuum') ? args[args.indexOf('--continuum') + 1] : process.env.JACO_CONTINUUM_URL || 'http://127.0.0.1:3020').replace(/\/+$/, '');
const actor = args.includes('--actor') ? args[args.indexOf('--actor') + 1] : 'delivery-gate';

if (!source) {
  console.error('Användning: delivery-gate-check.mjs <källa> --run "<testkommando>" [...]');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url).replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const jsonOut = path.join(os.tmpdir(), `delivery-gate-${Date.now()}.json`);

const pyArgs = ['-m', 'tools.delivery_gate.delivery_gate', source, '--json', jsonOut];
for (const cmd of runCmds) pyArgs.push('--run', cmd);

const proc = spawnSync('python3', pyArgs, { cwd: repoRoot, encoding: 'utf8' });
console.log(proc.stdout);
if (proc.stderr) console.error(proc.stderr);

let result = null;
try { result = JSON.parse(fs.readFileSync(jsonOut, 'utf8')); } catch { /* kvarstår null om gate kraschade helt */ }

if (!result) {
  console.error('[FAIL] delivery_gate producerade ingen JSON - kan inte spara evidence, betrakta som BLOCKED.');
  process.exit(1);
}

try {
  const res = await fetch(`${continuumUrl}/api/continuum/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'delivery-gate-verdict',
      claim: `delivery_gate verdict for '${source}': ${result.verdict}`,
      source: 'tools/delivery_gate (vendored jaco_agency)',
      verified: true,
      verificationMethod: 'deterministic CLI execution; exit code + command records captured verbatim',
      data: result,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (body?.success) {
    console.log(`[EVIDENCE] Sparad i Continuum: ${body.evidence.id} (${continuumUrl})`);
  } else {
    console.error(`[WARN] Kunde inte spara evidence i Continuum: ${JSON.stringify(body).slice(0, 300)}`);
  }
} catch (err) {
  console.error(`[WARN] Continuum onåbar (${err.message}) - gate-resultatet gäller ändå lokalt, bara inte sparat som evidence.`);
}

if (result.verdict === 'BLOCKED') process.exit(1);
if (result.verdict === 'UNPROVEN') process.exit(2);
process.exit(0);
