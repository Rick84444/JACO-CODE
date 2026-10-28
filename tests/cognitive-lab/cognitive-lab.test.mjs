import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapLab, runCognitiveLab, readJournal, inspectCognitiveLab } from '../../agents/lib/cognitive-lab.mjs';
import { loadCognitiveCapsule, assertCognitiveCapsuleTask } from '../../agents/lib/cognitive-capsule.mjs';
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lab-test-'));
const cleanup = dir => fs.rmSync(dir, { recursive: true, force: true });
const mission = {id: 'test', allowedTasks: ['mission-create','criteria-define','memory-query','candidate-propose','candidate-test-request','candidate-inspect','candidate-test','evidence-append','skill-promote']};

test('first mission fails weak hypothesis, then promotes reviewer-verified code', async () => {
  const dir = fixture();
  try {
    const result = await runCognitiveLab(dir);
    assert.equal(result.mode, 'DETERMINISTIC_THREE_ROLE_SIMULATION');
    assert.equal(result.languageModelUsed, false);
    assert.equal(result.memoryReused, false);
    assert.equal(result.attemptCount, 2);
    assert.deepEqual(result.attempts.map(a => [a.candidate,a.passed,a.total,a.accepted]), [['baseline',4,8,false],['hardened',8,8,true]]);
    assert.ok(fs.existsSync(result.attempts[1].evidenceFile));
    assert.equal(inspectCognitiveLab(dir).trustedKnowledgeItems, 1);
    const events = readJournal(dir);
    assert.ok(events.some(e => e.type === 'hypothesis.rejected'));
    assert.ok(events.some(e => e.type === 'skill.promoted'));
    assert.match(fs.readFileSync(path.join(dir, 'agents/developer-agent/skills/http-retry/SKILL.md'), 'utf8'), /Reviewer evidence/);
  } finally { cleanup(dir); }
});

test('second mission retrieves promoted knowledge and needs one attempt', async () => {
  const dir = fixture();
  try {
    await runCognitiveLab(dir);
    const r = await runCognitiveLab(dir);
    assert.equal(r.memoryReused, true);
    assert.equal(r.priorPromotions, 1);
    assert.equal(r.attemptCount, 1);
    assert.equal(r.attempts[0].passed, 8);
    assert.equal(r.accepted, true);
    assert.equal(inspectCognitiveLab(dir).trustedKnowledgeItems, 2);
    const c = loadCognitiveCapsule(path.join(dir,'agents/developer-agent'), { agentId: 'developer-agent',mission,withMemory:true });
    assert.equal(c.skills[0].name, 'http-retry');
    assert.match(c.home.text, /http-retry-safety/);
  } finally { cleanup(dir); }
});

test('cognitive capsule enforces actual role boundaries', () => {
  const dir = fixture();
  try {
    bootstrapLab(dir);
    const user = path.join(dir,'agents/user-agent');
    const dev = path.join(dir,'agents/developer-agent');
    const reviewer = path.join(dir,'agents/reviewer-agent');
    assert.throws(() => assertCognitiveCapsuleTask(user,{agentId:'user-agent',mission,task:'skill-promote'}), /CAPSULE_TASK_NOT_ALLOWED/);
    assert.throws(() => assertCognitiveCapsuleTask(dev,{agentId:'developer-agent',mission,task:'evidence-append'}), /CAPSULE_TASK_NOT_ALLOWED/);
    assert.throws(() => assertCognitiveCapsuleTask(reviewer,{agentId:'reviewer-agent',mission,task:'candidate-propose'}), /CAPSULE_TASK_NOT_ALLOWED/);
  } finally { cleanup(dir); }
});

test('unverified candidate cannot create promoted memory', async () => {
  const dir = fixture();
  try {
    const r = await runCognitiveLab(dir, {maxCandidates:1});
    assert.equal(r.accepted,false);
    assert.equal(r.attemptCount,1);
    assert.equal(inspectCognitiveLab(dir).trustedKnowledgeItems,0);
  } finally { cleanup(dir); }
});

test('journal modification is detected before second run', async () => {
  const dir = fixture();
  try {
    await runCognitiveLab(dir);
    const file = path.join(dir,'ledger.jsonl');
    fs.writeFileSync(file, fs.readFileSync(file,'utf8').replace('hypothesis.rejected','hypothesis.hidden'));
    assert.throws(() => readJournal(dir), /LEDGER_INTEGRITY_FAIL/);
    await assert.rejects(() => runCognitiveLab(dir), /LEDGER_INTEGRITY_FAIL/);
  } finally { cleanup(dir); }
});

test('truncated journal is rejected', async () => {
  const dir = fixture();
  try {
    await runCognitiveLab(dir);
    fs.appendFileSync(path.join(dir,'ledger.jsonl'), '{incomplete');
    assert.throws(() => readJournal(dir), /LEDGER_INCOMPLETE_RECORD/);
  } finally { cleanup(dir); }
});

test('concurrent writer lock blocks a run', async () => {
  const dir = fixture();
  try {
    bootstrapLab(dir);
    fs.mkdirSync(path.join(dir,'.writer.lock'));
    await assert.rejects(() => runCognitiveLab(dir), /LAB_CONCURRENT_WRITER/);
  } finally { cleanup(dir); }
});

test('symlinked capsule directory is rejected', () => {
  const dir = fixture();
  try {
    fs.mkdirSync(path.join(dir, 'agents'));
    fs.symlinkSync(os.tmpdir(), path.join(dir,'agents','user-agent'));
    assert.throws(() => bootstrapLab(dir), /LAB_DIRECTORY_UNSAFE/);
  } finally { cleanup(dir); }
});

test('misconfigured mission fails closed', async () => {
  const dir = fixture();
  try {
    await assert.rejects(() => runCognitiveLab(dir,{mission:'do-anything'}), /MISSION_UNSUPPORTED/);
    await assert.rejects(() => runCognitiveLab(dir,{maxCandidates:50}), /INVALID_MAX_CANDIDATES/);
  } finally { cleanup(dir); }
});

test('agent identity change changes prompt binding fingerprint', () => {
  const dir = fixture();
  try {
    bootstrapLab(dir);
    const home = path.join(dir,'agents/user-agent');
    const before = loadCognitiveCapsule(home,{ agentId:'user-agent',mission }).fingerprint;
    fs.appendFileSync(path.join(home,'prompts/IDENTITY.md'), '\n# Updated operator instruction\n');
    const after = loadCognitiveCapsule(home,{ agentId:'user-agent',mission }).fingerprint;
    assert.notEqual(before, after);
  } finally { cleanup(dir); }
});

test('deleting independent evidence prevents reuse of prior success', async () => {
  const dir = fixture();
  try {
    const first = await runCognitiveLab(dir);
    fs.unlinkSync(first.attempts[1].evidenceFile);
    assert.equal(inspectCognitiveLab(dir).trustedKnowledgeItems, 0);
    const next = await runCognitiveLab(dir);
    assert.equal(next.memoryReused, false);
    assert.equal(next.attemptCount, 2);
  } finally { cleanup(dir); }
});

test('editing evidence without touching ledger invalidates promotion', async () => {
  const dir = fixture();
  try {
    const first = await runCognitiveLab(dir);
    const file = first.attempts[1].evidenceFile;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    report.cases[0].passed = false;
    fs.writeFileSync(file, JSON.stringify(report));
    assert.equal(inspectCognitiveLab(dir).trustedKnowledgeItems, 0);
  } finally { cleanup(dir); }
});
