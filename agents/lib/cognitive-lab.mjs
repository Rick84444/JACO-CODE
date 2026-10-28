/**
 * JACO Cognitive Lab v1 — deterministic multi-agent simulation backed by real review.
 * - role-scoped Cognitive Capsules provide prompt, memory, and capability attenuation
 * - an append-only hash-linked journal records every decision and review
 * - candidate code is vetted by a separate process and a loopback HTTP test server
 * - only reviewer-confirmed, hash-bound knowledge influences future missions
 * Scope: local simulation only. Neither a general-purpose code agent nor OS sandbox.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureHome, appendMemory } from './agent-home.mjs';
import { initCognitiveCapsule, loadCognitiveCapsule, assertCognitiveCapsuleTask } from './cognitive-capsule.mjs';
import { attestReview, validateReviewAttestation } from './cognitive-evidence-authority.mjs';
import { CognitiveProgressGovernor } from './cognitive-progress.mjs';
import { ExecutionLeaseManager } from '../../runtime/src/server/continuum/leaseManager.mjs';

const libDir = path.dirname(fileURLToPath(import.meta.url));
const labDir = path.resolve(libDir, '..', 'cognitive-lab');
const runnerPath = path.join(labDir, 'reviewer-harness.mjs');
const ISSUE = 'http-retry-safety';
const ZERO = '0'.repeat(64);
const roles = Object.freeze({
  'user-agent': {
    tools: ['mission-create', 'criteria-define'],
    instructions: '# User Agent\nTranslate the operator\'s goal into bounded, testable acceptance criteria. Do not edit code or certify results.\n',
  },
  'developer-agent': {
    tools: ['memory-query', 'candidate-propose', 'candidate-test-request'],
    instructions: '# Developer Agent\nSelect and repair code hypotheses. Treat all recalled memory as untrusted until tied to review evidence. Never self-approve.\n',
  },
  'reviewer-agent': {
    tools: ['candidate-inspect', 'candidate-test', 'evidence-append', 'skill-promote'],
    instructions: '# Reviewer Agent\nIndependently test compiled candidates against behavioral acceptance criteria. Reject on any failure. Never edit the candidate.\n',
  },
});
const missionTools = [...new Set(Object.values(roles).flatMap(r => r.tools))];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = file => sha(fs.readFileSync(file));
const candidatePath = name => {
  if (name !== 'baseline' && name !== 'hardened') throw new Error('UNKNOWN_CANDIDATE');
  return path.join(labDir, 'templates', `retry-${name}.mjs`);
};
function ensureSafeState(state) {
  const root = path.resolve(state);
  const parts = root.split(path.sep).filter(Boolean);
  let current = path.parse(root).root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('LAB_STATE_SYMLINK_FORBIDDEN');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return root;
}
function safeChildDirectory(root, ...segments) {
  let dir = root;
  for (const segment of segments) {
    if (!/^[a-z][a-z0-9-]{0,55}$/.test(segment)) throw new Error('LAB_INVALID_DIRECTORY');
    dir = path.join(dir, segment);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('LAB_DIRECTORY_UNSAFE');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(dir, { mode: 0o700 });
    }
  }
  return dir;
}
function safeOutputFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('LAB_FILE_UNSAFE');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return file;
}
function roleDir(state, role) { return safeChildDirectory(state, 'agents', role); }
function capsule(state, role, id) {
  if (!Object.hasOwn(roles, role)) throw new Error('UNREGISTERED_AGENT');
  const mission = { id, allowedTasks: missionTools };
  const result = loadCognitiveCapsule(roleDir(state, role), { agentId: role, mission, withMemory: true });
  if (!result.enabled) throw new Error('ROLE_CAPSULE_REQUIRED');
  return result;
}
function permitted(state, role, id, task) {
  return assertCognitiveCapsuleTask(roleDir(state, role), { agentId: role, mission: { id, allowedTasks: missionTools }, task });
}
export function bootstrapLab(state) {
  const root = ensureSafeState(state);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  safeChildDirectory(root, 'agents');
  safeChildDirectory(root, 'evidence');
  for (const [agentId, definition] of Object.entries(roles)) {
    const dir = roleDir(root, agentId);
    ensureHome(dir);
    if (!fs.existsSync(path.join(dir, 'capsule.json'))) {
      initCognitiveCapsule(dir, agentId, { tools: definition.tools });
      fs.writeFileSync(path.join(dir, 'prompts', 'IDENTITY.md'), definition.instructions, { mode: 0o600 });
    }
    const c = capsule(root, agentId, 'bootstrap');
    if (c.allowedTasks.some(t => !definition.tools.includes(t))) throw new Error('ROLE_POLICY_ESCALATION');
  }
  return root;
}
function eventHash(record) { const { hash, ...rest } = record; return sha(JSON.stringify(rest)); }
/** Detect direct alteration/truncation of event chains; hash chain is not a signature. */
export function readJournal(state) {
  const file = path.join(ensureSafeState(state), 'ledger.jsonl');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  if (raw && !raw.endsWith('\n')) throw new Error('LEDGER_INCOMPLETE_RECORD');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length > 100_000) throw new Error('LEDGER_TOO_LARGE');
  let prev = ZERO;
  return lines.map((line, index) => {
    const e = JSON.parse(line);
    if (e.schema !== 'jaco.cognitive-lab-event/v1' || e.seq !== index + 1 || e.prev !== prev || e.hash !== eventHash(e))
      throw new Error(`LEDGER_INTEGRITY_FAIL_AT_${index + 1}`);
    prev = e.hash;
    return e;
  });
}
function makeWriter(root) {
  let journal = readJournal(root);
  return (type, actor, data) => {
    if (!Object.hasOwn(roles, actor) && actor !== 'runtime') throw new Error('INVALID_EVENT_ACTOR');
    const e = { schema: 'jaco.cognitive-lab-event/v1', seq: journal.length + 1,
      at: new Date().toISOString(), type, actor, data, prev: journal.at(-1)?.hash ?? ZERO };
    e.hash = eventHash(e);
    fs.appendFileSync(safeOutputFile(path.join(root, 'ledger.jsonl')), JSON.stringify(e) + '\n', { mode: 0o600 });
    journal.push(e);
    return e;
  };
}
function verifiedKnowledge(state) {
  const entries = readJournal(state);
  const evidence = new Map();
  for (const event of entries) {
    if (event.type === 'review.completed' && event.actor === 'reviewer-agent') {
      const d = event.data;
      if (d.issue === ISSUE && d.accepted && d.passed === d.total && d.total === 8 && d.harnessHash === shaFile(runnerPath))
        evidence.set(`${d.runId}:${d.candidate}:${d.codeHash}`, event.hash);
    }
  }
  const promotions = entries.filter(e => {
    if (e.type !== 'skill.promoted' || e.actor !== 'reviewer-agent') return false;
    const d = e.data;
    const evidenceKey = `${d.runId}:${d.candidate}:${d.codeHash}`;
    if (d.issue !== ISSUE || evidence.get(evidenceKey) !== d.reviewEventHash || d.codeHash !== shaFile(candidatePath(d.candidate))) return false;
    // A ledger promotion must be supported by an existing, matching runner output.
    if (!/^[a-f0-9-]{36}-[1-9][0-9]*\.json$/.test(d.evidenceFile || '')) return false;
    const evidencePath = path.join(state, 'evidence', d.evidenceFile);
    try {
      const st = fs.lstatSync(evidencePath);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 100_000) return false;
      const report = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      return report.runId === d.runId && report.candidate === d.candidate && report.codeHash === d.codeHash &&
        report.reviewEventHash === d.reviewEventHash && report.accepted === true && report.passed === 8 &&
        report.total === 8 && Array.isArray(report.cases) && report.cases.length === 8 &&
        report.cases.every(c => c.passed === true) &&
        validateReviewAttestation(state, {runId: d.runId, candidate: d.candidate, report: {candidate:report.candidate, codeHash:report.codeHash, passed:report.passed, total:report.total, accepted:report.accepted, cases:report.cases},
          attestation:report.attestation, reviewerFingerprint:report.reviewerFingerprint}) &&
        report.attestation.harnessHash === shaFile(runnerPath) &&
        report.reviewerFingerprint === capsule(state, 'reviewer-agent', d.runId).fingerprint;
    } catch { return false; }
  });
  return { promotions, total: promotions.length, latest: promotions.at(-1) ?? null };
}
async function reviewInChild(candidate) {
  const result = spawnSync(process.execPath, [runnerPath, candidate], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 300_000,
    cwd: labDir, env: { PATH: process.env.PATH || '', HOME: os.tmpdir() },
  });
  if (result.error || ![0, 2].includes(result.status)) throw new Error(`REVIEW_RUNNER_FAILED:${result.error?.message || result.stderr?.slice(0, 180)}`);
  const report = JSON.parse(result.stdout.trim());
  if (report.candidate !== candidate || report.codeHash !== shaFile(candidatePath(candidate)) || report.total !== 8 ||
      report.passed !== report.cases.filter(c => c.passed === true).length || report.accepted !== (report.passed === 8) ||
      (result.status === 0) !== report.accepted) throw new Error('REVIEW_EVIDENCE_INCONSISTENT');
  return {report, execution: {exitCode: result.status, stdout: result.stdout, stderr: result.stderr}};
}
function promoteSkill(state, report, runId, reviewEventHash) {
  const skill = path.join(roleDir(state, 'developer-agent'), 'skills', 'http-retry');
  safeChildDirectory(state, 'agents', 'developer-agent', 'skills', 'http-retry');
  const content = `---\nname: http-retry\ndescription: Verified bounded and idempotency-aware HTTP retry policy\n---\n# HTTP retry\n\nTrusted template: ${report.candidate}\nCode SHA-256: ${report.codeHash}\nReviewer evidence: ${reviewEventHash}\nRun: ${runId}\n\nAll eight contract cases passed against a local HTTP server. This metadata does not grant permissions.\n`;
  const file = safeOutputFile(path.join(skill, 'SKILL.md'));
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
const criteria = Object.freeze([
  'recover from GET 503', 'do not duplicate POST', 'do not retry HTTP 400',
  'honor HTTP 429 Retry-After', 'bound retries', 'honor pre-aborted signal',
  'honor abort during backoff', 'reject unbounded retry configuration',
]);
/** Single-writer run; protects persistent state from two concurrent local controllers. */
export async function runCognitiveLab(state, { mission = ISSUE, maxCandidates = 2 } = {}) {
  if (mission !== ISSUE) throw new Error('MISSION_UNSUPPORTED');
  if (maxCandidates !== 1 && maxCandidates !== 2) throw new Error('INVALID_MAX_CANDIDATES');
  const root = bootstrapLab(state);
  const lock = path.join(root, '.writer.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (err) { if (err.code === 'EEXIST') throw new Error('LAB_CONCURRENT_WRITER'); throw err; }
  try {
    const write = makeWriter(root);
    const runId = randomUUID();
    const ids = Object.fromEntries(Object.keys(roles).map(role => [role, capsule(root, role, runId).fingerprint]));
    const leases = new ExecutionLeaseManager(root, null, {assertExecutionAllowed() {}}, null);
    const leaseIds = Object.fromEntries(Object.entries(roles).map(([role, def]) =>
      [role, leases.issue({id:`${runId}:${role}`, missionId:runId, agentId:role, allowedActions:def.tools,
        durationMs:15*60_000, maxActions:25, maxCloudUsd:0}).id]));
    const allow = (role, action) => {
      const cap = permitted(root,role,runId,action);
      if (cap.fingerprint !== ids[role]) throw new Error('COGNITIVE_CAPSULE_CHANGED_DURING_MISSION');
      leases.authorize(leaseIds[role], {action, agentId:role, missionId:runId});
      return cap;
    };
    const governor = new CognitiveProgressGovernor({maxSteps: 3, maxStalls: 1});
    allow('user-agent', 'mission-create');
    allow('user-agent', 'criteria-define');
    write('mission.created', 'user-agent', { runId, issue: ISSUE, acceptanceCriteria: criteria, userAgent: ids['user-agent'] });

    allow('developer-agent', 'memory-query');
    const knowledge = verifiedKnowledge(root);
    const prior = knowledge.latest;
    const startingCandidate = prior ? prior.data.candidate : 'baseline';
    write('memory.retrieved', 'developer-agent', { runId, availablePromotions: knowledge.total,
      selected: startingCandidate, reviewBound: prior?.data.reviewEventHash ?? null, capsule: ids['developer-agent'] });

    const plan = [startingCandidate];
    if (startingCandidate === 'baseline' && maxCandidates === 2) plan.push('hardened');
    const attempts = [];
    let promoted = false;
    for (const candidate of plan) {
      allow('developer-agent', 'candidate-propose');
      const codeHash = shaFile(candidatePath(candidate));
      governor.before(`${candidate}:${codeHash}`);
      write('hypothesis.proposed', 'developer-agent', { runId, issue: ISSUE, candidate, codeHash, rationale: candidate === 'baseline'
        ? 'Minimal exponential retry baseline; hypothesis requires adversarial testing'
        : 'Idempotency-aware bounded retry with abort and throttling handling' });
      allow('developer-agent', 'candidate-test-request');
      allow('reviewer-agent', 'candidate-inspect');
      allow('reviewer-agent', 'candidate-test');
      // Reserve before the subprocess starts. A restart preserves UNKNOWN_OUTCOME
      // rather than replaying an unconfirmed side effect (even on localhost).
      const operationId = `${runId}:${candidate}:review`;
      const reservation = leases.beginAction(leaseIds['reviewer-agent'], {
        operationId, action:'candidate-test', agentId:'reviewer-agent', missionId:runId});
      let result, execution;
      try {
        ({report:result, execution} = await reviewInChild(candidate));
        leases.finishAction(leaseIds['reviewer-agent'], {operationId, generation:reservation.generation,
          receiptRef:`sha256:${sha(JSON.stringify(result))}`});
      } catch (err) {
        leases.markUnknown(leaseIds['reviewer-agent'], {operationId, reason:String(err.message).slice(0,300)});
        throw err;
      }
      const attestation = attestReview(root, {runId, candidate, report:result, exitCode:execution.exitCode,
        stdout:execution.stdout, stderr:execution.stderr,
        harnessHash:shaFile(runnerPath), reviewerFingerprint:ids['reviewer-agent']});
      const progress = governor.observe(`${candidate}:${codeHash}`, result);
      write('progress.observed', 'runtime', {runId, candidate, codeHash, ...progress});
      allow('reviewer-agent', 'evidence-append');
      const reviewEvent = write('review.completed', 'reviewer-agent', { runId, issue: ISSUE, candidate,
        codeHash: result.codeHash, passed: result.passed, total: result.total, accepted: result.accepted,
        failedCases: result.cases.filter(c => !c.passed).map(c => c.name), reviewerAgent: ids['reviewer-agent'],
        harnessHash: shaFile(runnerPath) });
      const evidenceFile = path.join(safeChildDirectory(root, 'evidence'), `${runId}-${attempts.length + 1}.json`);
      fs.writeFileSync(evidenceFile, JSON.stringify({ runId, reviewEventHash: reviewEvent.hash, reviewerFingerprint:ids['reviewer-agent'], ...result, attestation }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      attempts.push({ candidate, attestationHash:sha(JSON.stringify(attestation)), progress, passed: result.passed, total: result.total, accepted: result.accepted,
        failedCases: result.cases.filter(c => !c.passed).map(c => c.name), codeHash, evidenceFile });
      if (result.accepted) {
        allow('reviewer-agent', 'skill-promote');
        write('skill.promoted', 'reviewer-agent', { runId, issue: ISSUE, candidate, codeHash,
          attestationHash:sha(JSON.stringify(attestation)),
          reviewEventHash: reviewEvent.hash, evidenceFile: path.basename(evidenceFile) });
        promoteSkill(root, result, runId, reviewEvent.hash);
        appendMemory(roleDir(root, 'developer-agent'), `${ISSUE}: ${candidate} passed ${result.passed}/${result.total}; evidence ${reviewEvent.hash.slice(0, 16)}; not a general correctness proof.`);
        appendMemory(roleDir(root, 'reviewer-agent'), `Reviewed ${ISSUE} ${candidate} (${codeHash.slice(0, 16)}): ${result.passed}/${result.total} pass.`);
        promoted = true;
        break;
      }
      write('hypothesis.rejected', 'reviewer-agent', { runId, candidate, failedCases: attempts.at(-1).failedCases });
    }
    const report = { schema: 'jaco.cognitive-lab-report/v1', runId, issue: ISSUE,
      mode: 'DETERMINISTIC_THREE_ROLE_SIMULATION', verificationMode:'CHILD_EXIT_HASHED_AND_HMAC_ATTESTED',
      leaseBound:true, progressGoverned:true, verifiedCodeExecution: true, languageModelUsed: false,
      state: root, capsuleFingerprints: ids, memoryReused: Boolean(prior), priorPromotions: knowledge.total,
      attempts, accepted: promoted, attemptCount: attempts.length,
      ledgerTip: readJournal(root).at(-1)?.hash ?? ZERO };
    fs.writeFileSync(safeOutputFile(path.join(root, 'latest-report.json')), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    return report;
  } finally { fs.rmdirSync(lock); }
}
export function inspectCognitiveLab(state) {
  const root = ensureSafeState(state);
  const journal = readJournal(root);
  const knowledge = verifiedKnowledge(root);
  return { events: journal.length, ledgerTip: journal.at(-1)?.hash ?? ZERO,
    trustedKnowledgeItems: knowledge.total,
    latestTrusted: knowledge.latest ? { candidate: knowledge.latest.data.candidate, codeHash: knowledge.latest.data.codeHash,
      reviewEventHash: knowledge.latest.data.reviewEventHash } : null };
}
