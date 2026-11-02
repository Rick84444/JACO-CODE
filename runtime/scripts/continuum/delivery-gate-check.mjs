#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/**
 * Quality gate for external deliveries (e.g. before a JACO agent may
 * mark a paid a2acolony/a2amarket task as completed).
 *
 * Runs the vendored Python tool tools/delivery_gate (from
 * jaco_agency_2.zip) against a source file/folder + optional commands that MUST
 * succeed, and stores the real, deterministic outcome as real
 * Continuum evidence - not a claimed status, an actually executed
 * command's exit code.
 *
 * Exit codes mirror delivery_gate itself:
 *   0 = PASS       (evidence stored, verified:true, may proceed)
 *   1 = BLOCKED     (stubs/unfounded numbers found - stop the delivery)
 *   2 = UNPROVEN    (no command was run - nothing proven)
 *
 * Usage:
 *   node scripts/continuum/delivery-gate-check.mjs <source> \
 *     --run "<test command>" [--run "<more>"] \
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
  console.error('Usage: delivery-gate-check.mjs <source> --run "<test command>" [...]');
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
try { result = JSON.parse(fs.readFileSync(jsonOut, 'utf8')); } catch { /* stays null if the gate crashed completely */ }

if (!result) {
  console.error('[FAIL] delivery_gate produced no JSON - cannot store evidence, treat as BLOCKED.');
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
    console.log(`[EVIDENCE] Stored in Continuum: ${body.evidence.id} (${continuumUrl})`);
  } else {
    console.error(`[WARN] Could not store evidence in Continuum: ${JSON.stringify(body).slice(0, 300)}`);
  }
} catch (err) {
  console.error(`[WARN] Continuum unreachable (${err.message}) - the gate result still applies locally, just not stored as evidence.`);
}

if (result.verdict === 'BLOCKED') process.exit(1);
if (result.verdict === 'UNPROVEN') process.exit(2);
process.exit(0);
