import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { processMissionTurn } from '../../agents/lib/mission-client.mjs';

// Ensure isolation by clearing inherited coding root and preventing .env loading.
process.env.DOTENV_CONFIG_PATH = path.join(os.tmpdir(), 'nonexistent.env');
delete process.env.JACO_NOVA_CODING_ROOT;

// The real executor is imported with an isolated workspace, never the user's repo.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-desktop-code-'));
process.env.JACO_WORKSPACE_ROOT = root;
process.env.NOVA_STATE_DIR = path.join(root, 'state');
const { executeTask, plannerAllowedTasks, desktopAgentCard } = await import('../../agents/desktop-agentos.mjs');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('Desktop AgentOS advertises canonical code tools and offers them only with a contract', () => {
  assert.ok(desktopAgentCard().capabilities.tools.includes('repo-write'));
  assert.deepEqual(plannerAllowedTasks({ allowedTasks: ['repo-write', 'desktop-windows'] }), ['desktop-windows']);
  assert.deepEqual(plannerAllowedTasks({ allowedTasks: ['repo-read', 'repo-write'], contract: {} }), ['repo-read', 'repo-write']);
});

test('Desktop AgentOS performs code write and test through durable Nova and persists receipts across reopen', async () => {
  const stateDir = path.join(root, 'bus');
  let bus = new DurableMissionBus(stateDir);
  try {
    const control = new NovaMissionControl(bus, { allowedTasks: ['repo-write', 'repo-read', 'repo-test'] });
    const mission = control.create({
      goal: 'Write and verify a JavaScript module', idempotencyKey: 'desktop-code-proof', executor: 'desktop-agentos',
      contract: {
        objective: 'Write and verify a JavaScript module', scope: { allowed: ['src/**'] }, acceptance: ['module syntax passes'],
        verification: { commands: ['node --check src/value.mjs'], tests_required: true },
      },
    });
    const client = {
      current: async () => control.get(mission.id),
      claim: async (...args) => control.claim(...args),
      begin: async (...args) => control.begin(...args),
      finish: async (...args) => control.finish(...args),
      release: async (...args) => control.release(...args),
    };
    // Deterministic planning isolates actual executor, filesystem, test process and persistence.
    for (const task of [
      { type: 'repo-write', data: { path: 'src/value.mjs', content: 'export const value = 42;\n' } },
      { type: 'repo-read', data: { path: 'src/value.mjs' } },
      { type: 'repo-test', data: { command: 'node --check src/value.mjs', kind: 'test' } },
    ]) {
      const turn = await processMissionTurn({ client, owner: 'desktop-agentos-proof', plan: async () => ({ task }), execute: executeTask });
      assert.equal(turn.executed, true);
      assert.equal(turn.receipt.verified, true, turn.receipt.error);
    }
    assert.equal(fs.readFileSync(path.join(root, 'src/value.mjs'), 'utf8'), 'export const value = 42;\n');
    bus.close();
    bus = new DurableMissionBus(stateDir);
    const recovered = new NovaMissionControl(bus).get(mission.id);
    assert.equal(recovered.receipts.length, 3);
    assert.equal(recovered.receipts.every(receipt => receipt.verified === true), true);
    assert.equal(recovered.contractStatus.machineVerified, true);
  } finally { bus.close(); }
});

test('Desktop code execution refuses missing contracts and out-of-scope writes', async () => {
  const task = { type: 'repo-write', data: { path: 'outside.mjs', content: 'should never be written' } };
  await assert.rejects(executeTask(task, null), /CODING_CONTRACT_REQUIRED/);
  await assert.rejects(executeTask(task, { contract: { scope: { allowed: ['src/**'], forbidden: [] } }, receipts: [] }), /CODING_SCOPE_DENIED/);
  assert.equal(fs.existsSync(path.join(root, 'outside.mjs')), false);
});
