#!/usr/bin/env node
// Turns finished work into knowledge.
//
// The runtime records evidence for every completed task, but nothing compiled those results into
// reusable knowledge, so `knowledge` stayed at 0 no matter how much work ran. This walks completed
// and failed hub tasks, and writes one outcome per task through the canonical compiler
// (POST /cognition/outcomes), which links the evidence and marks the outcome SUCCESS or FAILURE.
//
// Usage: node scripts/continuum/compile-outcomes.mjs [--limit 20] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// indexOf returns -1 when the flag is absent, and args[-1 + 1] is the first argument: without this
// guard `--dry-run` alone parsed as the limit, became NaN and silently compiled nothing.
const limitIndex = args.indexOf('--limit');
const limitRaw = limitIndex === -1 ? null : args[limitIndex + 1];
const LIMIT = Math.max(1, Math.min(Number(limitRaw) || 20, 100));

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]).filter(([, v]) => v));
}
const ROOT = path.resolve(process.cwd());
const env = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '..', '.env')) };
const BASE = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || env.JACO_GATEWAY_TOKEN || '';
const H = { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-gateway-token': TOKEN } : {}) };

async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/continuum${route}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json).slice(0, 250)}`);
  return json;
}

const OUTCOME_BY_STATUS = { COMPLETED: 'SUCCESS', FAILED: 'FAILURE' };

const tasks = (await api('GET', '/hub/tasks')).tasks || [];
const knowledge = (await api('GET', '/knowledge?limit=1000')).knowledge || [];
const alreadyCompiled = new Set(knowledge.map((k) => String(k.implementation?.taskId || '')).filter(Boolean));

const finished = tasks
  .filter((t) => OUTCOME_BY_STATUS[t.status])
  .filter((t) => Array.isArray(t.evidenceRefs) && t.evidenceRefs.length)
  .filter((t) => !alreadyCompiled.has(t.id))
  .slice(0, LIMIT);

if (!finished.length) {
  console.log(`no finished tasks with evidence left to compile (${tasks.length} tasks seen, ${knowledge.length} knowledge nodes)`);
  process.exit(0);
}

let written = 0;
for (const task of finished) {
  const outcome = OUTCOME_BY_STATUS[task.status];
  const claim = `${outcome === 'SUCCESS' ? 'Completed' : 'Failed'}: ${String(task.title || task.kind).slice(0, 200)}`;
  if (DRY_RUN) {
    console.log(`${outcome.padEnd(7)} ${task.id} ${claim}`);
    continue;
  }
  try {
    const res = await api('POST', '/cognition/outcomes', {
      outcome,
      claim,
      missionId: task.missionId || null,
      evidenceRefs: task.evidenceRefs,
      kind: `task-outcome/${String(task.kind || 'unknown').toLowerCase()}`,
      confidence: outcome === 'SUCCESS' ? 0.8 : 0.9,
      failureModes: outcome === 'FAILURE' ? [String(task.error || 'task failed without a recorded reason').slice(0, 300)] : [],
      implementation: { taskId: task.id, commitmentId: task.commitmentId || null, kind: task.kind, acceptance: task.payload?.acceptance || null },
      actor: 'outcome-compiler-script',
    });
    written += 1;
    console.log(`${outcome.padEnd(7)} ${task.id} -> ${res.knowledge.id}`);
  } catch (error) {
    console.log(`SKIP    ${task.id}: ${String(error.message).slice(0, 160)}`);
  }
}

console.log(`\n${written} outcomes compiled into knowledge`);
