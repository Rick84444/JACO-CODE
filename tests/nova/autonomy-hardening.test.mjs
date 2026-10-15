import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { outgoingSpendCheck } from '../../runtime/src/server/connected/spendGuard.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';

const t = (type, data = {}) => ({ type, data, expectedOutcome: '' });

test('spend guard blocks paying actions on every acting surface', () => {
  assert.ok(outgoingSpendCheck(t('browser-click', { name: 'Buy now' })));
  assert.ok(outgoingSpendCheck(t('browser-click', { name: 'Betala' })));
  assert.ok(outgoingSpendCheck(t('desktop-invoke', { hwnd: 1, selector: { name: 'Subscribe' } })));
  assert.ok(outgoingSpendCheck(t('browser-type', { name: 'card', text: '4242 4242 4242 4242' })));
  assert.ok(outgoingSpendCheck(t('browser-click', { name: 'Continue' }), { observation: { url: 'https://checkout.stripe.com/c/pay/cs_live_x' } }));
  assert.ok(outgoingSpendCheck(t('shell', { command: 'curl https://api.stripe.com/v1/payouts -d amount=100' })));
  assert.ok(outgoingSpendCheck(t('shell', { command: 'stripe transfers create --amount 500' })));
});

test('spend guard lets normal work and incoming revenue through', () => {
  assert.equal(outgoingSpendCheck(t('browser-click', { name: 'New discussion' })), null);
  assert.equal(outgoingSpendCheck(t('type-text', { text: 'git checkout -b feature' })), null);
  assert.equal(outgoingSpendCheck(t('shell', { command: 'curl https://api.stripe.com/v1/checkout/sessions -d mode=payment' })), null);
  assert.equal(outgoingSpendCheck(t('shell', { command: 'curl https://api.stripe.com/v1/payment_links' })), null);
  assert.equal(outgoingSpendCheck(t('repo-read', { path: 'pay.md' })), null);
  assert.equal(outgoingSpendCheck(t('browser-survey-site', { url: 'https://example.com/checkout' })), null);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-protect-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git('init', '-q', '-b', 'master');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a'); git('add', 'a.txt'); git('commit', '-qm', 'init');
  return { dir, git };
}
const verified = [{ ok: true, verified: true, type: 'repo-read', actionId: 'r1' }];
const contract = normalizeCodingContract({ objective: 'test protected branches', scope: { allowed: ['**'] }, acceptance: ['branch policy enforced'], verification: { tests_required: false } });

test('agents cannot push or merge into a protected branch', async () => {
  const { dir, git } = repo();
  const ws = createCodingWorkspace({ root: dir, protectedBranches: ['master', 'main'] });
  await assert.rejects(ws.execute(t('git-push'), contract, { receipts: verified }), /CODING_GIT_PUSH_PROTECTED_BRANCH:master/);
  git('checkout', '-qb', 'feature');
  git('checkout', '-q', 'master');
  await assert.rejects(ws.execute(t('git-merge', { ref: 'feature' }), contract, { receipts: verified }), /CODING_GIT_MERGE_PROTECTED_BRANCH:master/);
});

test('agent branch without upstream resolves remote instead of throwing on git config', async () => {
  const { dir, git } = repo();
  git('checkout', '-qb', 'nova/work');
  const ws = createCodingWorkspace({ root: dir, protectedBranches: ['master'] });
  // No remote exists, so the push itself fails: it must get as far as `git push origin HEAD:nova/work`.
  await assert.rejects(ws.execute(t('git-push'), contract, { receipts: verified }), error => {
    const message = String(error?.message);
    return message.includes('git push origin HEAD:nova/work') && !message.includes('PROTECTED_BRANCH');
  });
});

test('Nova mission is BLOCKED (and stays blocked) on outgoing spend until the operator approves one action', async () => {
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-spend-'));
  const bus = new DurableMissionBus(dir);
  const control = new NovaMissionControl(bus);
  const mission = control.create({ goal: 'publish a post', idempotencyKey: 'spend-1', allowedTasks: ['browser-click'] });
  const claim = () => control.claim(mission.id, 'nova-test');
  let lease = claim();
  assert.throws(() => control.begin(mission.id, { owner: 'nova-test', token: lease.token, task: t('browser-click', { name: 'Upgrade to Pro' }) }), /OUTGOING_SPEND_REQUIRES_OPERATOR/);
  assert.equal(control.get(mission.id).status, 'BLOCKED');
  assert.ok(bus.listEvents(20).some(e => e.type === 'NOVA_SPEND_BLOCKED'));

  // An automated resume does not approve spend.
  control.resolve(mission.id, { decision: 'resume', note: 'auto-resumed (level 5): transient', authority: 'operator' });
  lease = claim();
  assert.throws(() => control.begin(mission.id, { owner: 'nova-test', token: lease.token, task: t('browser-click', { name: 'Upgrade to Pro' }) }), /OUTGOING_SPEND_REQUIRES_OPERATOR/);

  // The operator's explicit approval covers exactly one action.
  control.resolve(mission.id, { decision: 'resume', note: 'ok, köp Pro-planen [approve-spend]', authority: 'operator' });
  lease = claim();
  const action = control.begin(mission.id, { owner: 'nova-test', token: lease.token, task: t('browser-click', { name: 'Upgrade to Pro' }) });
  assert.equal(action.type, 'browser-click');
  control.finish(mission.id, { owner: 'nova-test', token: lease.token, actionId: action.id, receipt: { ok: true, verified: true } });
  lease = claim();
  assert.throws(() => control.begin(mission.id, { owner: 'nova-test', token: lease.token, task: t('browser-click', { name: 'Buy add-on' }) }), /OUTGOING_SPEND_REQUIRES_OPERATOR/);
});

test('web-fetch is a read-only GET task: http(s) url required, allowed by default, never an acting spend task', async () => {
  const { validateTask, TASK_FIELDS } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  assert.deepEqual(TASK_FIELDS['web-fetch'], ['url']);
  assert.throws(() => validateTask(t('web-fetch', {}), ['web-fetch']), /TASK_FIELD_REQUIRED:url/);
  assert.throws(() => validateTask(t('web-fetch', { url: 'file:///C:/Windows/win.ini' }), ['web-fetch']), /INVALID_URL/);
  assert.equal(validateTask(t('web-fetch', { url: 'https://huggingface.co/spaces' }), ['web-fetch']).type, 'web-fetch');
  assert.equal(outgoingSpendCheck(t('web-fetch', { url: 'https://checkout.stripe.com/pay/x' })), null);
});

test('web-fetch drops method/body/headers so every executor performs a plain GET', async () => {
  const { validateTask } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const checked = validateTask(t('web-fetch', { url: 'https://api.stripe.com/v1/payouts', method: 'POST', body: 'amount=100', headers: { Authorization: 'x' } }), ['web-fetch']);
  assert.deepEqual(checked.data, { url: 'https://api.stripe.com/v1/payouts' });
});

test('Nova shell receipts carry exit-code evidence and bounded output', async () => {
  const { localTools } = await import('../../agents/hands-off-agent.mjs');
  const ok = localTools.shell('node -e "console.log(\'x\'.repeat(20000))"');
  assert.equal(ok.ok, true); assert.equal(ok.verified, true); assert.equal(ok.exitCode, 0);
  assert.equal(ok.outputBytes, 20000); assert.ok(ok.output.length < 9000); assert.match(ok.sha256, /^[0-9a-f]{64}$/);
  const bad = localTools.shell('node -e "process.exit(3)"');
  assert.equal(bad.ok, false); assert.equal(bad.verified, false); assert.equal(bad.exitCode, 3);
  assert.match(localTools.shell('type .env').error, /SHELL_BLOCKED_PAYMENT_SECRET_POLICY/);
});

test('an exhausted coding budget blocks the mission on the first failure', async () => {
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-budget-'))));
  const mission = control.create({ goal: 'read files', idempotencyKey: 'budget-1', allowedTasks: ['health-check'] });
  const lease = control.claim(mission.id, 'nova-test');
  control.release(mission.id, { owner: 'nova-test', token: lease.token, error: 'CODING_CONTRACT_DURATION_EXCEEDED' });
  assert.equal(control.get(mission.id).status, 'BLOCKED');
});

test('re-phrased goals join the open mission instead of creating a duplicate', async () => {
  const { goalSimilarity } = await import('../../runtime/src/server/connected/missionDedupe.mjs');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  assert.ok(goalSimilarity('Skapa en strukturerad rapport inventory_report.md som sammanfattar kodinventeringen', 'Generera en strukturerad rapport inventory_report.md som sammanfattar kodinventeringen') >= 0.8);
  assert.ok(goalSimilarity('Övervaka Ollama-kvoten var 5 min', 'Utför högst 20 webbsökningar på olika webbplatser') < 0.5);
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-dedupe-'))));
  const first = control.create({ goal: 'Skapa en strukturerad rapport inventory_report.md som sammanfattar kodinventeringen', idempotencyKey: 'd1', allowedTasks: ['health-check'] });
  const again = control.create({ goal: 'Generera en strukturerad rapport inventory_report.md som sammanfattar kodinventeringen', idempotencyKey: 'd2', allowedTasks: ['health-check'] });
  assert.equal(again.id, first.id); assert.equal(again.deduplicated, true);
  const other = control.create({ goal: 'Kontrollera att HuggingFace Space svarar och rapportera status', idempotencyKey: 'd3', allowedTasks: ['health-check'] });
  assert.notEqual(other.id, first.id);
  control.resolve(first.id, { decision: 'cancel', note: 'test done' });
  const fresh = control.create({ goal: 'Generera en strukturerad rapport inventory_report.md som sammanfattar kodinventeringen', idempotencyKey: 'd4', allowedTasks: ['health-check'] });
  assert.notEqual(fresh.id, first.id);
});

test('planner context stays small and focused even with a long mission history', async () => {
  const { compactMissionForBrain } = await import('../../agents/hands-off-agent.mjs');
  const { observationFingerprint } = await import('../../agents/lib/mission-client.mjs');
  const page = { url: 'https://example.com', title: 'Example', text: 'x'.repeat(6000), targets: Array.from({ length: 80 }, (_, i) => ({ selector: 'div > a:nth-of-type(' + i + ')', text: 'link ' + i, role: 'a', visible: true, bbox: [0, 0, 1, 1] })) };
  const receipts = Array.from({ length: 40 }, (_, i) => ({ type: 'shell', ok: i % 2 === 0, verified: i % 2 === 0, error: i % 2 ? 'boom ' + i : undefined, before: page, after: page, result: { output: 'y'.repeat(8000) } }));
  const compact = compactMissionForBrain({ id: 'm', goal: 'Research the market', allowedTasks: ['web-fetch'], receipts });
  const size = JSON.stringify(compact).length;
  assert.ok(size < 15000, 'compact mission ' + size + ' chars');
  assert.ok(size < JSON.stringify(receipts).length / 50);
  assert.equal(compact.receiptsTotal, 40);
  assert.equal(compact.recentReceipts.length, 8);
  assert.equal(compact.goal, 'Research the market');
  assert.match(compact.recentReceipts.at(-1).error, /boom 39/);
  assert.deepEqual(observationFingerprint(page), { at: null, url: 'https://example.com', title: 'Example', targets: 80, textChars: 6000 });
});

test('Nova honours the operator primary provider before the default order', async () => {
  const { orderedBrainProviders } = await import('../../agents/hands-off-agent.mjs');
  assert.equal(orderedBrainProviders({ JACO_PRIMARY_PROVIDER: 'qwen' })[0].name, 'qwen');
  // Default order is cost-first (free capable planners), never a small local model first.
  const defaultFirst = orderedBrainProviders({})[0].name;
  assert.notEqual(defaultFirst, 'ollama');
  assert.equal(orderedBrainProviders({ JACO_PRIMARY_PROVIDER: 'nope' })[0].name, defaultFirst);
  const names = orderedBrainProviders({ JACO_PRIMARY_PROVIDER: 'qwen' }).map(p => p.name);
  assert.equal(new Set(names).size, names.length);
});
