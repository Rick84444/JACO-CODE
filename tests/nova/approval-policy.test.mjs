import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoResolution, autoApprovalLevel, autoApproveGate, loadApprovalPolicy, updateApprovalPolicy, setOperatorApprovalLevel } from '../../agents/lib/approval-policy.mjs';

const r = (type, extra = {}) => ({ ok: true, verified: true, type, ...extra });
const awaiting = (receipts, extra = {}) => ({ id: 'm', status: 'AWAITING_VERIFICATION', goal: 'audit code', receipts, ...extra });

test('level 0 never auto-resolves, unset means the highest level, invalid levels fall back to 0', () => {
  assert.equal(autoResolution(awaiting([r('repo-read')]), { level: 0 }), null);
  assert.equal(autoApprovalLevel({}), 5, 'full autonomy unless the operator lowers it');
  assert.equal(autoApprovalLevel({ JACO_AUTO_APPROVE_LEVEL: '0' }), 0);
  assert.equal(autoApprovalLevel({ JACO_AUTO_APPROVE_LEVEL: '9' }), 0);
  assert.equal(autoApprovalLevel({ JACO_AUTO_APPROVE_LEVEL: '5' }), 5);
});

test('level 1 confirms verified read-only completions only', () => {
  assert.equal(autoResolution(awaiting([r('repo-list'), r('repo-read')]), { level: 1 })?.decision, 'confirm');
  assert.equal(autoResolution(awaiting([r('repo-read'), r('repo-write')]), { level: 1 }), null);
  assert.equal(autoResolution(awaiting([r('browser-click')]), { level: 2 }), null);
});

test('level 2 confirms code work only with a machine-verified contract', () => {
  const m = awaiting([r('repo-write'), r('repo-test'), r('git-commit')], { contract: {} });
  assert.equal(autoResolution({ ...m, contractStatus: { machineVerified: false } }, { level: 5 }), null);
  assert.equal(autoResolution({ ...m, contractStatus: { machineVerified: true } }, { level: 2 })?.decision, 'confirm');
});

test('level 3+ confirms any verified completion, but never outgoing spend', () => {
  assert.equal(autoResolution(awaiting([r('browser-click'), r('shell')]), { level: 3 })?.decision, 'confirm');
  assert.equal(autoResolution(awaiting([r('browser-click')], { goal: 'Buy a domain for the launch' }), { level: 5 }), null);
  assert.equal(autoResolution(awaiting([r('invoke-worker')], { goal: 'Betala fakturan till leverantören' }), { level: 5 }), null);
  assert.equal(autoResolution(awaiting([r('shell')], { goal: 'rotate logs' }), { level: 5, extraBlocked: ['rotate'] }), null);
});

test('ambiguous engineering vocabulary (transfer/wallet/withdraw/charge) only blocks with real financial context nearby', () => {
  // Found live 2026-09-29: bare-word matches on "transfer"/"wallet" forced operator confirmation on
  // ordinary engineering work that has nothing to do with payment.
  assert.equal(autoResolution(awaiting([r('shell')], { goal: 'Optimize the file transfer batching in the sync worker' }), { level: 5 })?.decision, 'confirm');
  assert.equal(autoResolution(awaiting([r('web-fetch')], { goal: 'Research wallet address clustering heuristics for the paper' }), { level: 5 })?.decision, 'confirm');
  assert.equal(autoResolution(awaiting([r('shell')], { goal: 'Fix the battery charge indicator on the Android widget' }), { level: 5 })?.decision, 'confirm');
  // Same words WITH financial context still block, as they should.
  assert.equal(autoResolution(awaiting([r('shell')], { goal: 'Transfer $500 from the operator bank account' }), { level: 5 }), null);
  assert.equal(autoResolution(awaiting([r('shell')], { goal: 'Withdraw funds from the crypto wallet' }), { level: 5 }), null);
});

test('uncertain or unverified outcomes always wait for the operator', () => {
  assert.equal(autoResolution(awaiting([r('repo-read', { outcomeUnknown: true })]), { level: 5 }), null);
  assert.equal(autoResolution(awaiting([{ ok: true, verified: false, type: 'repo-read' }]), { level: 5 }), null);
  assert.equal(autoResolution({ id: 'm', status: 'BLOCKED', phase: 'INTERRUPTED', receipts: [] }, { level: 5, lastError: 'fetch failed' }), null);
});

test('BLOCKED: transient resumes from level 1, recoverable from level 3, policy blocks never, once only', () => {
  const m = { id: 'm', status: 'BLOCKED', goal: 'audit', receipts: [] };
  assert.equal(autoResolution(m, { level: 1, lastError: 'fetch failed' })?.decision, 'resume');
  assert.equal(autoResolution(m, { level: 1, lastError: 'fetch failed', autoResumes: 1 }), null);
  assert.equal(autoResolution(m, { level: 1, lastError: 'CODING_SCOPE_DENIED:.' }), null);
  assert.equal(autoResolution(m, { level: 3, lastError: 'CODING_SCOPE_DENIED:.' })?.decision, 'resume');
  assert.equal(autoResolution(m, { level: 5, lastError: 'SHELL_BLOCKED_PAYMENT_SECRET_POLICY' }), null);
  assert.equal(autoResolution(m, { level: 5, lastError: 'ORIGIN_DENIED' }), null);
  assert.equal(autoResolution(m, { level: 5, lastError: 'CODING_CONTRACT_DURATION_EXCEEDED' }), null, 'only the operator can extend a budget');
  assert.equal(autoResolution(m, { level: 5, lastError: 'CODING_CONTRACT_STEP_BUDGET_EXCEEDED' }), null);
});

test('an autonomous coding contract keeps resuming within its budget, then stops for the operator', () => {
  // Operator 2026-10-02: fewer approvals; work autonomously within the contract's policy.
  const contract = { execution: { autonomous: true }, budget: { max_steps: 40, max_failures: 3 } };
  const m = { id: 'm', status: 'BLOCKED', goal: 'fix the scanner test', contract, receipts: [] };
  const verdict = autoResolution(m, { level: 2, lastError: 'Command failed: node --test x', autoResumes: 5 });
  assert.equal(verdict?.decision, 'resume', 'past the one-retry limit, inside the contract');
  assert.match(verdict.note, /^auto-resumed .*within the autonomous coding contract/);
  assert.equal(autoResolution(m, { level: 2, lastError: 'Command failed', autoResumes: 14 }), null, 'ceil(40/3) retries cover the step budget');
  assert.equal(autoResolution(m, { level: 1, lastError: 'Command failed', autoResumes: 1 }), null, 'level 1 keeps one retry');
  assert.equal(autoResolution(m, { level: 5, lastError: 'CODING_CONTRACT_STEP_BUDGET_EXCEEDED' }), null, 'budget used up: operator');
  assert.equal(autoResolution(m, { level: 5, lastError: 'PLANNER_BLOCKED:no capability', autoResumes: 1 }), null, 'capability gap: one retry only');
  assert.equal(autoResolution(m, { level: 5, lastError: 'SHELL_BLOCKED_PAYMENT_SECRET_POLICY' }), null);
  assert.equal(autoResolution({ ...m, goal: 'buy a domain' }, { level: 5, lastError: 'Command failed' }), null, 'spend never');
  assert.equal(autoResolution({ ...m, receipts: [{ ok: true, verified: false, type: 'repo-write' }] }, { level: 5, lastError: 'x' }), null, 'uncertain outcome never');
  assert.equal(autoResolution({ ...m, contract: { ...contract, execution: { autonomous: false } } }, { level: 5, lastError: 'Command failed', autoResumes: 1 }), null, 'non-autonomous contract: one retry');
});

test('jobs from level 4, MCP sources from level 5, never spend', () => {
  assert.equal(autoApproveGate('JOB', 'report job', { level: 3 }), false);
  assert.equal(autoApproveGate('JOB', 'report job', { level: 4 }), true);
  assert.equal(autoApproveGate('JOB', 'stripe payout job', { level: 5 }), false);
  assert.equal(autoApproveGate('MCP_SOURCE', 'github.com/x/y', { level: 4 }), false);
  assert.equal(autoApproveGate('MCP_SOURCE', 'github.com/x/y', { level: 5 }), true);
});

test('agents can change the rules only with the operator grant, with a reason, and it is logged', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-policy-')), 'approval-policy.json');
  assert.throws(() => updateApprovalPolicy({ level: 3, reason: 'x' }, { env: {}, file }), /POLICY_EDIT_NOT_GRANTED/);
  const env = { JACO_POLICY_EDIT_GRANT: '1', JACO_AUTO_APPROVE_LEVEL: '5' };
  assert.throws(() => updateApprovalPolicy({ level: 3 }, { env, file }), /POLICY_REASON_REQUIRED/);
  assert.throws(() => updateApprovalPolicy({ level: 7, reason: 'x' }, { env, file }), /POLICY_LEVEL_INVALID/);
  updateApprovalPolicy({ level: 3, reason: 'too many retries on HF', actor: 'seer' }, { env, file });
  assert.equal(loadApprovalPolicy({ env, file }).level, 3);
  assert.equal(loadApprovalPolicy({ env: { JACO_AUTO_APPROVE_LEVEL: '5' }, file }).level, 5);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).history[0].actor, 'seer');
});

test('level 5: our own LLM API usage is outside the spend stop, real outgoing spend still waits', () => {
  const llm = [
    'Kontrollera API-kostnad och tokens för Groq och Ollama Cloud.',
    'The LLM inference cost was 0.02 USD within the budget.',
    'Use DeepSeek to generate a development plan.',
  ];
  for (const goal of llm) assert.equal(autoResolution(awaiting([r('repo-read')], { goal }), { level: 5 })?.decision, 'confirm', goal);
  for (const goal of ['Buy a domain for 12 USD.', 'Use DeepSeek to plan, then pay the hosting invoice.', 'Köp en prenumeration på verktyget.', 'Top up DeepSeek API credits so the planner can continue.', 'Köp nya API-krediter för modellen.']) {
    assert.equal(autoResolution(awaiting([r('repo-read')], { goal }), { level: 5 }), null, goal);
  }
  assert.equal(autoApproveGate('JOB', 'Refresh the Groq API key usage report', { level: 5 }), true);
});

test('operator alone selects a persistent level even when agents cannot edit policy', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-operator-autonomy-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'policy.json');
  const env = { JACO_AUTO_APPROVE_LEVEL: '5', JACO_POLICY_EDIT_GRANT: '0' };
  assert.equal(loadApprovalPolicy({ env, file }).level, 5);
  assert.equal(loadApprovalPolicy({ env, file }).editsGranted, false);
  assert.equal(setOperatorApprovalLevel(2, { env, file }).level, 2);
  assert.equal(loadApprovalPolicy({ env, file }).source, 'operator');
  assert.throws(() => updateApprovalPolicy({ level: 5, reason: 'agent wants control' }, { env, file }), /POLICY_EDIT_NOT_GRANTED/);
  assert.equal(loadApprovalPolicy({ env, file }).level, 2);
  const agentGranted = { JACO_AUTO_APPROVE_LEVEL: '5', JACO_POLICY_EDIT_GRANT: '1' };
  updateApprovalPolicy({ level: 5, reason: 'agent attempts to raise autonomy' }, { env: agentGranted, file });
  assert.equal(loadApprovalPolicy({ env: agentGranted, file }).level, 2, 'agent level cannot override operator');
  assert.equal(setOperatorApprovalLevel(5, { env, file }).level, 5);
  assert.throws(() => setOperatorApprovalLevel('3', { env, file }), /POLICY_LEVEL_INVALID/);
  assert.throws(() => setOperatorApprovalLevel(9, { env, file }), /POLICY_LEVEL_INVALID/);
});
