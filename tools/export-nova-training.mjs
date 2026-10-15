#!/usr/bin/env node
// Exports Nova's verified steps as chat-format training examples (JSONL) for fine-tuning a small local
// planner (operator 2026-10-09: an own model, trained for free on Kaggle or the RTX 3050 desktop).
//
// One example per step: the mission goal and the steps so far -> the next action Nova took. Only steps
// whose result was ok AND verified, from finished and cancelled missions (a cancelled mission's verified
// steps were still correct). Loops are cut: one example per goal and action, at most 25 per goal.
// Secrets from .env and common token shapes are redacted.
//
//   node --experimental-sqlite tools/export-nova-training.mjs [mission-bus.sqlite] [.env] [out.jsonl]
//
// Defaults: the runtime's .jaco/mission-bus/mission-bus.sqlite, the root .env and
// .jaco/training/nova-steps.jsonl (under .jaco, which git ignores).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeJaco = join(root, 'runtime', '.jaco');
const [dbPath = join(runtimeJaco, 'mission-bus', 'mission-bus.sqlite'), envPath = join(root, '.env'), outPath = join(runtimeJaco, 'training', 'nova-steps.jsonl')] = process.argv.slice(2);
const PER_GOAL = 25;

const secrets = (existsSync(envPath) ? readFileSync(envPath, 'utf8') : '').split(/\r?\n/)
  .map(line => /^\s*([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line))
  .filter(m => m && /KEY|TOKEN|SECRET|PASSWORD|HASH|BEARER|UUID/.test(m[1]))
  .map(m => m[2].trim().replace(/^(['"])(.*)\1$/, '$2'))
  .filter(v => v.length >= 8)
  .sort((a, b) => b.length - a.length);
const TOKEN_SHAPES = [/\b(sk|pk|rk|hf|gh[pousr]|xox[abp]|jdev|jide)[-_][A-Za-z0-9_-]{12,}/g, /\b[A-Za-z0-9+/]{40,}={0,2}/g, /Bearer\s+\S+/g];
const redact = text => {
  let s = String(text ?? '');
  for (const v of secrets) s = s.split(v).join('[REDACTED]');
  for (const re of TOKEN_SHAPES) s = s.replace(re, '[REDACTED]');
  return s;
};
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);

const SYSTEM = 'You are Nova, the JACO executor. Given the mission goal and the steps so far, reply with the next action as JSON: {"type": <task>, "data": {...}, "expectedOutcome": <what success looks like>}.';

const db = new DatabaseSync(dbPath, { readOnly: true });
const missions = db.prepare("SELECT id, goal FROM missions WHERE status IN ('DONE','CANCELLED')").all();
const steps = db.prepare("SELECT type, payload_json p FROM events WHERE mission_id=? AND type IN ('NOVA_ACTION_STARTED','NOVA_ACTION_RESULT') ORDER BY seq");

const seen = new Set();
const perGoal = new Map();
const out = [];
const stats = { missions: missions.length, steps: 0, verified: 0, repeated: 0, overGoalCap: 0, kept: 0 };
for (const mission of missions) {
  const goal = clip(redact(mission.goal).replace(/\n\nAUTONOMOUS REPAIR CONTEXT:[\s\S]*$/, ''), 2000);
  const history = [];
  let pending = null;
  for (const row of steps.all(mission.id)) {
    const p = JSON.parse(row.p || '{}');
    if (row.type === 'NOVA_ACTION_STARTED') { pending = p.action; continue; }
    if (!pending) continue;
    stats.steps++;
    const action = { type: pending.type, data: pending.data ?? {}, expectedOutcome: pending.expectedOutcome ?? '' };
    const ok = p.ok === true && p.verified === true;
    if (ok) {
      stats.verified++;
      const target = redact(JSON.stringify(action));
      const goalKey = goal.slice(0, 200);
      const key = goalKey + '|' + redact(JSON.stringify({ type: action.type, data: action.data }));
      if (seen.has(key)) stats.repeated++;
      else if ((perGoal.get(goalKey) || 0) >= PER_GOAL) stats.overGoalCap++;
      else {
        seen.add(key);
        perGoal.set(goalKey, (perGoal.get(goalKey) || 0) + 1);
        const user = `Goal:\n${goal}\n\nSteps so far:\n${history.length ? history.slice(-8).join('\n') : '(none)'}`;
        out.push({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: target }] });
      }
    }
    const summary = clip(redact(JSON.stringify(p.result?.output ?? p.result ?? p.error ?? '')), 300);
    history.push(`${history.length + 1}. ${action.type} ${clip(redact(JSON.stringify(action.data)), 200)} -> ${ok ? 'ok' : 'failed'}: ${summary}`);
    pending = null;
  }
}
stats.kept = out.length;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.map(o => JSON.stringify(o)).join('\n') + '\n');
const byType = {};
for (const o of out) { const t = JSON.parse(o.messages[2].content).type; byType[t] = (byType[t] || 0) + 1; }
console.log(JSON.stringify({ ...stats, goals: perGoal.size, byType, out: outPath }, null, 1));
