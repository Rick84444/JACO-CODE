#!/usr/bin/env node
// Bridges Continuum code commitments to the canonical coding executor.
//
// Continuum plans work, but its scheduler has no code task kind: code commitments sat PROPOSED
// forever while seven of them piled up. The coding executor already exists on the other side:
// SEER turns a self-development request into a jaco.coding-contract/v1, and the durable Nova
// executor reads, writes, tests and makes scoped local commits under that contract. This script
// connects the two without adding a second executor:
//
//   Continuum code commitment
//     -> contract drafted by the planner model (through the economic gate)
//     -> contract validated here against the scope allowlist
//     -> POST SEER /cortex/self-development (dispatch: true)
//     -> durable Nova mission
//     -> reconciled back onto the commitment on later runs
//
// Nova is single-writer, so at most one coding mission runs at a time.
//
// Usage: node scripts/continuum/dispatch-code-work.mjs [--dry-run] [--reconcile-only]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RECONCILE_ONLY = args.includes('--reconcile-only');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]).filter(([, v]) => v));
}
const ROOT = path.resolve(process.cwd());
const env = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '..', '.env')) };
const RUNTIME = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const SEER = process.env.SEER_URL || 'http://127.0.0.1:2997';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || env.JACO_GATEWAY_TOKEN || '';

async function call(base, method, route, body, auth) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(200_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json).slice(0, 260)}`);
  return json;
}
const continuum = (method, route, body) => call(RUNTIME, method, `/api/continuum${route}`, body, { 'x-gateway-token': TOKEN });
const nova = (method, route, body) => call(RUNTIME, method, `/api/connected/nova${route}`, body, { 'x-gateway-token': TOKEN });
const seer = (method, route, body) => call(SEER, method, route, body, { Authorization: `Bearer ${TOKEN}` });

// Roots a drafted contract may touch. Anything else is dropped before SEER sees it; SEER then adds
// its own protected paths (executor, validator, governor, workflows, manifests) on top.
const SCOPE_ROOTS = [
  'runtime/scripts/',
  'runtime/src/server/continuum/',
  'runtime/public/',
  'runtime/docs/',
  'scratchpad/workers/',
  'tests/',
  'docs/',
];
const FORBIDDEN = ['.env*', '**/*secret*', '**/*.key', '**/node_modules/**'];

export function sanitizeScope(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map((p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter((p) => p && !p.includes('..') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p))
    .filter((p) => SCOPE_ROOTS.some((root) => p.startsWith(root))))].slice(0, 12);
}

export function sanitizeCommands(commands) {
  const ok = (c) => /^node --check [\w./-]+\.(m?js|cjs)$/.test(c) || /^node --test( [\w./-]+\.(m?js|cjs))+$/.test(c);
  return [...new Set((Array.isArray(commands) ? commands : []).map((c) => String(c || '').trim()).filter(ok))].slice(0, 4);
}

const CONTRACT_INSTRUCTIONS = `You turn one repository change request into a coding contract for an autonomous executor.
Reply with JSON only:
{"title":"...","objective":"...","allowed":["path/or/glob/**"],"acceptance":["checkable statement"],"commands":["node --test tests/x.test.mjs"]}
Rules:
- allowed: the smallest set of repository-relative paths or globs the change needs, under these roots only:
${SCOPE_ROOTS.map((r) => `  ${r}`).join('\n')}
- commands: only "node --check <file>" or "node --test <file ...>" with repository-relative paths. At least one.
  Prefer adding a new test file under tests/ and running it.
- acceptance: 2 to 5 statements that the commands prove.
- If the change cannot be done inside those roots, reply {"refuse":"<reason>"}.`;

function parseJson(text) {
  const s = String(text).replace(/```json|```/g, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('contract draft is not JSON');
  return JSON.parse(s.slice(start, end + 1));
}

async function draftContract(commitment, mission) {
  const reasoning = await continuum('POST', '/models/reason', {
    providerId: 'deepseek-planner',
    purpose: 'coding-contract-draft',
    missionId: mission.id,
    instructions: CONTRACT_INSTRUCTIONS,
    prompt: `CHANGE REQUEST:\n${commitment.title}\n\n${commitment.description}\n\nMISSION:\n${String(mission.objective).slice(0, 1500)}`,
    reasoningEffort: 'low',
    maxOutputTokens: 6000,
    estimatedUsd: 0.02,
    timeoutMs: 180_000,
  });
  const draft = parseJson(reasoning.result?.text || '');
  if (draft.refuse) return { refused: String(draft.refuse).slice(0, 300) };
  const allowed = sanitizeScope(draft.allowed);
  const commands = sanitizeCommands(draft.commands);
  const acceptance = (Array.isArray(draft.acceptance) ? draft.acceptance : []).map((a) => String(a).slice(0, 300)).filter(Boolean).slice(0, 5);
  if (!allowed.length) return { refused: 'no allowed path inside the scope roots' };
  if (!commands.length) return { refused: 'no allowlisted verification command' };
  if (!acceptance.length) return { refused: 'no acceptance criteria' };
  return {
    title: String(draft.title || commitment.title).slice(0, 280),
    objective: `${String(draft.objective || commitment.title).slice(0, 2000)}\n\nContinuum commitment: ${commitment.id}`,
    scope: { allowed, forbidden: FORBIDDEN },
    acceptance,
    verification: { commands, falsifier_required: true },
    plannedBy: `${reasoning.result?.providerId}:${reasoning.result?.model}`,
  };
}

function isCodeCommitment(c) {
  return (c.execution?.payload?.plannerKind === 'code') && !String(c.execution?.kind || '').trim();
}

// ---- reconcile: move commitments forward as their Nova missions progress ----
// The dispatch record is evidence, so the link between a commitment and its Nova mission survives
// restarts and is auditable.
async function dispatchLinks() {
  try {
    const res = await continuum('GET', '/evidence?kind=coding-dispatch&limit=500');
    const records = Array.isArray(res) ? res : (res.evidence || res.data || []);
    const links = new Map();
    for (const e of records) if (e?.data?.commitmentId && e?.data?.novaMissionId) links.set(e.data.commitmentId, e.data.novaMissionId);
    return links;
  } catch (error) {
    return new Map();
  }
}

async function reconcile(commitments) {
  const links = await dispatchLinks();
  let moved = 0;
  for (const c of commitments.filter((x) => x.state === 'ACTIVE' && isCodeCommitment(x))) {
    const novaId = links.get(c.id);
    if (!novaId) continue;
    let mission;
    try { mission = (await nova('GET', `/missions/${encodeURIComponent(novaId)}`)).mission; } catch { continue; }
    const status = String(mission?.status || '');
    if (['AWAITING_VERIFICATION', 'COMPLETED', 'VERIFIED'].includes(status)) {
      const ev = await continuum('POST', '/evidence', {
        kind: 'coding-mission-result', claim: `Nova coding mission ${novaId} reached ${status} for commitment ${c.id}`,
        source: 'nova', verified: false, data: { novaMissionId: novaId, status, receipts: (mission.receipts || []).slice(-5) },
      });
      await continuum('POST', `/commitments/${c.id}/transition`, { state: 'VERIFYING', reason: `Nova ${novaId} ${status}; waiting for operator verification`, evidenceRefs: [ev.evidence.id] });
      moved += 1;
      console.log(`verify  ${c.id} <- ${novaId} ${status}`);
    } else if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(status)) {
      await continuum('POST', `/commitments/${c.id}/transition`, { state: 'BLOCKED', reason: `Nova ${novaId} ${status}: ${String(mission.error || mission.lastError || '').slice(0, 200)}` });
      moved += 1;
      console.log(`blocked ${c.id} <- ${novaId} ${status}`);
    }
  }
  return moved;
}

// ---- main ----
const missions = ((await continuum('GET', '/missions')).missions || []).filter((m) => m.state === 'ACTIVE');
const all = [];
for (const m of missions) {
  const list = (await continuum('GET', `/commitments?missionId=${encodeURIComponent(m.id)}`)).commitments || [];
  for (const c of list) all.push({ ...c, mission: m });
}

const moved = await reconcile(all);
if (moved) console.log(`${moved} commitment(s) reconciled from Nova`);
if (RECONCILE_ONLY) process.exit(0);

// Nova runs one mission at a time; never queue a second coding mission behind an active one.
let current = null;
try { current = (await nova('GET', '/current')).mission; } catch (error) { console.log(`cannot read Nova state: ${error.message}`); process.exit(1); }
if (current && ['ACTIVE', 'CLAIMED', 'RUNNING'].includes(String(current.status))) {
  console.log(`Nova is busy with ${current.id} (${current.status}); not dispatching`);
  process.exit(0);
}

const candidates = all.filter((c) => c.state === 'PROPOSED' && isCodeCommitment(c) && c.execution?.consequence !== 'IRREVERSIBLE');
if (!candidates.length) {
  console.log(`no code commitment waiting (${all.filter(isCodeCommitment).length} code commitments across ${missions.length} active missions)`);
  process.exit(0);
}

for (const commitment of candidates) {
  const contract = await draftContract(commitment, commitment.mission);
  if (contract.refused) {
    console.log(`skip    ${commitment.id}: contract refused (${contract.refused})`);
    continue;
  }
  console.log(`contract for ${commitment.id}: ${contract.title}`);
  console.log(`  allowed:  ${contract.scope.allowed.join(', ')}`);
  console.log(`  commands: ${contract.verification.commands.join(' | ')}`);
  if (DRY_RUN) process.exit(0);

  const { plannedBy, ...request } = contract;
  const created = await seer('POST', '/cortex/self-development', { schema: 'jaco.self-development/v1', ...request, dispatch: true });
  const novaId = created.nova?.id || null;
  if (!novaId) throw new Error(`SEER created graph ${created.graph?.id} but returned no Nova mission id`);
  const record = await continuum('POST', '/evidence', {
    kind: 'coding-dispatch',
    claim: `Commitment ${commitment.id} dispatched to Nova ${novaId}`,
    source: 'dispatch-code-work',
    verified: true,
    verificationMethod: 'SEER self-development response carried the Nova mission id',
    data: { commitmentId: commitment.id, novaMissionId: novaId, graphId: created.graph?.id || null, contract: request, plannedBy },
  });
  await continuum('POST', `/commitments/${commitment.id}/transition`, { state: 'ACCEPTED', reason: `contract drafted by ${plannedBy}` });
  await continuum('POST', `/commitments/${commitment.id}/transition`, { state: 'ACTIVE', reason: `dispatched to Nova ${novaId} via SEER graph ${created.graph?.id || '?'}`, evidenceRefs: [record.evidence.id] });
  console.log(`dispatched ${commitment.id} -> SEER graph ${created.graph?.id} -> Nova ${novaId}`);
  break; // one coding mission at a time
}
