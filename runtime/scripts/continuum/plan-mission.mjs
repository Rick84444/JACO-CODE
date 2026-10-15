#!/usr/bin/env node
// Turns an ACTIVE mission into concrete commitments.
//
// This is the missing link between "here is the goal" and the scheduler: SEER regulates how work
// runs, the executors run tasks, but nothing decomposed a goal into work. The planner reads the
// mission, asks the model router (which enforces the economic gate) for a decomposition, and writes
// the result as commitments with acceptance criteria.
//
// Usage:
//   node scripts/continuum/plan-mission.mjs [--mission <id>] [--max 4] [--dry-run] [--accept]
//
// Commitments are PROPOSED by default: the operator accepts them. With --accept, reversible work
// that the scheduler can actually run is accepted automatically, which is what lets the stack keep
// working between operator sessions. Irreversible work always waits for a human.
//
// It is deliberately conservative: it never creates more than `--max` commitments per run, never
// touches a mission that already has open work, and refuses anything the operator has not allowed.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
const DRY_RUN = args.includes('--dry-run');
const AUTO_ACCEPT = args.includes('--accept');
const MAX_NEW = Math.max(1, Math.min(Number(flag('max', 4)), 8));

const ROOT = path.resolve(process.cwd());
// The stack keeps its operator token in the repository-root .env; the runtime directory has its own
// .env with different values, so read both and let the root win.
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]).filter(([, v]) => v));
}
const env = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '..', '.env')) };

const BASE = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || env.JACO_GATEWAY_TOKEN || '';
const H = { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-gateway-token': TOKEN } : {}) };

async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/continuum${route}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const INSTRUCTIONS = `You are JACO's mission planner. You turn one mission objective into a small number of
concrete commitments that an autonomous runtime can execute and verify.

Rules:
- Each commitment is one deliverable, doable in under a day, by a coding or browser agent, or by a
  clearly named operator step.
- Every commitment needs an acceptance criterion that can be checked from evidence: a file, a test
  result, an HTTP response, a receipt. Never "improve", "consider" or "explore".
- Respect the mission invariants and the listed blockers. If a blocker makes work impossible, say so
  in operatorStep instead of inventing a workaround.
- Order matters: put what unblocks the rest first.
- "kind" must be one of:
  research  - analysis, comparison or a written artifact the runtime can produce by reasoning
  code      - a change in the repository (executed by the Nova coding executor)
  browser   - work in a browser session
  operator  - a step only the human operator can take (credentials, payments, account setup)
- Reply with JSON only, no prose and no code fence:
{"commitments":[{"title":"...","description":"...","acceptance":"...","kind":"code|browser|operator|research","consequence":"REVERSIBLE|IRREVERSIBLE","dependsOnIndex":null}]}`;

function buildPrompt(mission, existing) {
  return [
    `MISSION OBJECTIVE:\n${mission.objective}`,
    `\nINVARIANTS:\n${(mission.invariants || []).map((s) => `- ${s}`).join('\n') || '- none'}`,
    `\nKNOWN BLOCKERS:\n${(mission.blockers || []).map((s) => `- ${s}`).join('\n') || '- none'}`,
    `\nNEXT ACTION THE OPERATOR NOTED:\n${mission.nextAction || '- none'}`,
    `\nCOMMITMENTS THAT ALREADY EXIST (do not repeat them):\n${existing.map((c) => `- [${c.state}] ${c.title}`).join('\n') || '- none'}`,
    `\nPropose at most ${MAX_NEW} new commitments that move this mission forward now.`,
  ].join('\n');
}

/** Models like to wrap JSON in prose or emit more than one object, so scan for the first balanced one. */
function firstJsonObject(text) {
  const s = String(text);
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i += 1) {
      const ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }
  throw new Error(`planner returned no parsable JSON object: ${s.slice(0, 300)}`);
}

function parseCommitments(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const parsed = firstJsonObject(cleaned);
  const list = Array.isArray(parsed.commitments) ? parsed.commitments : [];
  return list
    .filter((c) => c && typeof c.title === 'string' && c.title.trim() && typeof c.acceptance === 'string' && c.acceptance.trim())
    .slice(0, MAX_NEW);
}

// The scheduler only knows its own task kinds. A planner kind maps to one of those, or to no
// execution at all when the work needs a human or an executor that does not live in Continuum;
// a commitment without execution.kind is simply never materialised as a task.
const SCHEDULER_KIND = { research: 'MODEL_REASON' };

function executionFor(proposal, mission, planning) {
  const acceptance = String(proposal.acceptance).slice(0, 800);
  const base = {
    consequence: proposal.consequence === 'IRREVERSIBLE' ? 'IRREVERSIBLE' : 'REVERSIBLE',
    payload: { acceptance, plannedBy: `${planning.providerId}:${planning.model}`, plannerKind: proposal.kind || 'research' },
  };
  const kind = SCHEDULER_KIND[proposal.kind];
  if (!kind) return { ...base, kind: '' };
  return {
    ...base,
    kind,
    payload: {
      ...base.payload,
      // MODEL_REASON runs through the router, so it obeys the same economic gate as planning.
      prompt: `${proposal.title}

${String(proposal.description || '')}

Mission objective:
${mission.objective}

Acceptance criterion:
${acceptance}

Produce the deliverable. If it cannot be produced without an operator step or an external credential, say exactly what is missing instead of guessing.`,
      instructions: 'You are a JACO runtime worker. Produce the concrete deliverable, state uncertainty explicitly, and never claim an external action you have no evidence for.',
      requiredCapabilities: ['reasoning'],
      maxOutputTokens: 4000,
      reasoningEffort: 'low',
      estimatedUsd: 0.02,
    },
  };
}

const missions = (await api('GET', '/missions')).missions || [];
const wanted = flag('mission');
const mission = typeof wanted === 'string'
  ? missions.find((m) => m.id === wanted)
  : missions.find((m) => m.state === 'ACTIVE');
if (!mission) {
  console.log('no ACTIVE mission to plan for');
  process.exit(0);
}

const existing = ((await api('GET', `/commitments?missionId=${encodeURIComponent(mission.id)}`)).commitments || []);
// Only runnable work counts against the cap. Commitments that wait on the operator or an executor
// outside Continuum have no execution kind and never run, so counting them froze the queue: two such
// commitments blocked all planning for a whole five-hour cycle while nothing executed. They are still
// listed in the prompt, so the planner does not propose them again.
const open = existing.filter((c) => !['FULFILLED', 'CANCELLED', 'FAILED'].includes(c.state));
const runnable = open.filter((c) => String(c.execution?.kind || '').trim());
const waiting = open.length - runnable.length;
if (runnable.length >= MAX_NEW) {
  console.log(`mission ${mission.id} already has ${runnable.length} runnable open commitments; nothing to plan`);
  process.exit(0);
}
if (waiting) console.log(`${waiting} open commitment(s) wait on the operator or an outside executor and do not block planning`);

// Every cycle the planner proposed more code work that no executor here can run, and the waiting
// pile grew from 2 to 7 while nothing executed. Past this backlog, plan only what the runtime can
// run now; the waiting work stays where it is until the operator or the coding executor takes it.
const WAITING_BACKLOG_LIMIT = 3;
const RUNNABLE_ONLY = waiting >= WAITING_BACKLOG_LIMIT;
if (RUNNABLE_ONLY) console.log(`waiting backlog is ${waiting} (limit ${WAITING_BACKLOG_LIMIT}): planning runnable research work only`);

console.log(`planning for ${mission.id}: ${String(mission.objective).split('\n')[0].slice(0, 80)}`);
// Planning is the one step a 4B local model cannot do: it produced zero usable proposals in 104 s.
// The provider is named explicitly so planning uses the planner model and nothing else silently does.
const reasoning = await api('POST', '/models/reason', {
  providerId: flag('provider', 'deepseek-planner'),
  prompt: buildPrompt(mission, existing) + (RUNNABLE_ONLY
    ? `\n\nCONSTRAINT FOR THIS ROUND: ${waiting} commitments already wait on the operator or the coding executor. Propose ONLY kind "research" work the runtime can finish now by reasoning, such as analyses, drafts, comparisons or specifications that make the waiting work faster to execute. No code, browser or operator work this round.`
    : ''),
  instructions: INSTRUCTIONS,
  purpose: 'mission-planning',
  missionId: mission.id,
  // Reasoning models spend most of the budget before the answer starts; at full effort deepseek-flash
  // burned 8000 tokens on reasoning and returned nothing. Low effort answers in about 800.
  reasoningEffort: 'low',
  maxOutputTokens: 8000,
  estimatedUsd: 0.02,
  expectedValueUsd: null,
  timeoutMs: 180000,
});

const result = reasoning.result || {};
const parsedProposals = parseCommitments(result.text || '');
// The model does not always obey the constraint, so enforce it here too.
const proposals = RUNNABLE_ONLY ? parsedProposals.filter((p) => SCHEDULER_KIND[p.kind]) : parsedProposals;
if (proposals.length < parsedProposals.length) console.log(`dropped ${parsedProposals.length - proposals.length} non-runnable proposal(s) because of the waiting backlog`);
console.log(`model ${result.model} via ${result.providerId} in ${result.latencyMs} ms, ${proposals.length} proposals`);

if (DRY_RUN) {
  for (const p of proposals) console.log(`\n- ${p.title}\n  ${p.acceptance}`);
  process.exit(0);
}

const created = [];
const runnableCreated = new Set();
for (const [index, p] of proposals.entries()) {
  // A dependency on work that has no execution kind can never be fulfilled by the runtime, so it
  // would block this commitment forever. Keep only dependencies on runnable work; the rest is noted
  // in the description as context instead of as a hard edge.
  const depId = Number.isInteger(p.dependsOnIndex) ? created[p.dependsOnIndex] : null;
  const dependsOn = depId && runnableCreated.has(depId) ? [depId] : [];
  if (depId && !dependsOn.length) p.description = `${p.description || ''}\n\nSoft dependency (not blocking): ${proposals[p.dependsOnIndex]?.title || depId}`;
  const commitment = await api('POST', '/commitments', {
    missionId: mission.id,
    title: String(p.title).slice(0, 500),
    description: `${String(p.description || '').slice(0, 3000)}\n\nACCEPTANCE: ${String(p.acceptance).slice(0, 800)}`,
    dependsOn,
    execution: executionFor(p, mission, result),
  });
  created.push(commitment.commitment.id);
  const execution = commitment.commitment.execution || {};
  if (execution.kind) runnableCreated.add(commitment.commitment.id);
  let note = 'proposed, waiting for the operator';
  if (AUTO_ACCEPT && execution.kind && execution.consequence !== 'IRREVERSIBLE') {
    await api('POST', `/commitments/${commitment.commitment.id}/transition`, { state: 'ACCEPTED', reason: 'auto-accepted: reversible work the scheduler can run' });
    note = `accepted, runs as ${execution.kind}`;
  } else if (!execution.kind) {
    note = `needs ${p.kind === 'operator' ? 'the operator' : 'an executor outside Continuum'}`;
  }
  console.log(`created ${commitment.commitment.id}: ${p.title} (${note})`);
}

console.log(`\n${created.length} commitments created for ${mission.id}`);
