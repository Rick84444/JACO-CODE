// No model/provider fixture: this exercises actual Shack calculation, HTTP dispatch,
// SQLite receipts, filesystem changes, child-process tests and SEER auto-confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import express from 'express';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';
import { checkedReceipt } from '../../agents/lib/mission-client.mjs';
import { readStrategicContext } from '../../agents/lib/strategic-context.mjs';

async function until(read, accept, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('RUNTIME_RESULT_TIMEOUT');
}

test('operational Shack closes actual failing code through SEER HTTP -> Nova -> verification -> unlocked dispatch', { timeout: 25000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-shack-runtime-'));
  const bus = new DurableMissionBus(path.join(root, 'bus'));
  const control = new NovaMissionControl(bus, { allowedTasks: ['repo-read', 'repo-write', 'repo-test'] });
  const app = express();
  app.use(express.json());
  const token = 'shack-runtime-test-12345678901234567890';
  const dispatchOrder = [];
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === '/api/connected/nova/missions') dispatchOrder.push(req.body.parent.nodeKey);
    next();
  });
  mountNovaMissionRoutes(app, (req, res, next) => req.headers['x-gateway-token'] === token ? next() : res.status(401).json({ error: 'UNAUTHORIZED' }), control);
  const runtime = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const runtimeUrl = `http://127.0.0.1:${runtime.address().port}`;
  const child = spawn(process.execPath, ['gateway/src/seer.mjs'], {
    env: { PATH: process.env.PATH, SEER_PORT: '0', SEER_STATE_DIR: path.join(root, 'seer'),
      JACO_GATEWAY_TOKEN: token, JACO_RUNTIME_URL: runtimeUrl,
      JACO_WORKPLACE_REQUIRED: '0', JACO_WORKPLACE_URL: 'http://127.0.0.1:9',
      SEER_AUTONOMY_LOOP_MS: '3000', SEER_AUTONOMY_MAX_DISPATCH: '1', SEER_GOVERNOR_INTERVAL_MS: '0',
      A2ACOLONY_SYNC_INTERVAL_MS: '0', JACO_ALLOW_PAID_MODELS: '0',
      JACO_LITERT_URL: 'http://127.0.0.1:9/v1', OLLAMA_BASE_URL: 'http://127.0.0.1:9', JACO_SEER_MODEL_DISCOVERY_TIMEOUT_MS: '100',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    child.kill(); await exited;
    runtime.closeAllConnections(); await new Promise(resolve => runtime.close(resolve));
    bus.close(); fs.rmSync(root, { recursive: true, force: true });
  });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const port = await until(() => /JACO_SEER_LISTENING port=(\d+)/.exec(output)?.[1], Boolean);
  const seerUrl = `http://127.0.0.1:${port}`;
  async function request(route, payload) {
    const response = await fetch(seerUrl + route, { method: payload ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'src/value.mjs'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'tests/value.test.mjs'), "import assert from 'node:assert/strict';\nimport { value } from '../src/value.mjs';\nassert.equal(value, 2);\n");
  let initialFailure;
  const verificationEnv = { ...process.env };
  delete verificationEnv.NODE_TEST_CONTEXT;
  try { execFileSync(process.execPath, ['--test', 'tests/value.test.mjs'], { cwd: root, stdio: 'pipe', env: verificationEnv }); }
  catch (error) { initialFailure = error.status; }
  assert.equal(initialFailure, 1, 'verification must actually fail before the repair');

  const contract = normalizeCodingContract({ objective: 'Restore value=2 and verify actual output',
    scope: { allowed: ['src/**', 'tests/**'] }, acceptance: ['real test returns exit code zero'],
    verification: { commands: ['node --test tests/value.test.mjs'], tests_required: true, falsifier_required: false },
    execution: { autonomous: true, allow_git_commit: false, allow_git_push: false, allow_git_merge: false },
  });
  const workspace = createCodingWorkspace({ root });
  const actualRed = await workspace.execute({ type: 'repo-test', data: { command: 'node --test tests/value.test.mjs', kind: 'test' } }, contract, { actor: 'initial-falsifier', receipts: [] });
  assert.equal(actualRed.ok, false, 'the production verifier must actually run and reject the broken source');
  const graph = await request('/cortex/mission-graphs', { title: 'Real capability restoration', objective: contract.objective,
    policy: { autonomy: 'closed-loop', allowedTasks: ['repo-read', 'repo-write', 'repo-test'] },
    nodes: [
      { key: 'polish', objective: 'Check source after restoration', contract, strategy: { goalImpact: 0.1, verificationGain: 0.1 } },
      { key: 'repair', objective: 'Fix the observed failing output', contract, strategy: { goalImpact: 0.4, verificationGain: 1 } },
      { key: 'deliver', objective: 'Verify downstream acceptance', contract, strategy: { goalImpact: 1, verificationGain: 1 } },
    ], obstacles: [{ id: 'red-test', blocks: ['deliver'], clearBy: ['repair'], severity: 1 }],
  });
  const route = `/cortex/mission-graphs/${graph.id}`;
  const joined = await request('/cortex/agents/ping', { id: 'shack-proof-client', name: 'Shack proof client', capabilities: ['reasoning'] });
  assert.equal(joined.strategic_context.path, '/cortex/strategic-board');
  assert.match(joined.strategic_context.instructions, /SEER owns the shared Shack/);
  const shared = await request('/cortex/context/claude');
  assert.equal(shared.mission_graphs[0].strategic_board.missionId, graph.id);
  assert.match(shared.strategic_agent_instructions, /contract.*allowedTasks.*budget/);
  assert.equal((await fetch(seerUrl + route + '/board')).status, 401);
  assert.deepEqual((await request(route + '/ready')).map(node => node.key), ['repair', 'polish']);

  async function execute(mission, task) {
    const lease = control.claim(mission.id, 'nova-runtime-proof');
    const action = control.begin(mission.id, { owner: 'nova-runtime-proof', token: lease.token, task });
    const current = control.get(mission.id);
    const result = await workspace.execute(action, current.contract, { actor: 'nova-runtime-proof', receipts: current.receipts });
    const receipt = checkedReceipt(action, result);
    assert.equal(receipt.ok, true, JSON.stringify(result));
    assert.equal(receipt.verified, true);
    control.finish(mission.id, { owner: 'nova-runtime-proof', token: lease.token, actionId: action.id, receipt });
    return result;
  }
  async function complete(key, write = false) {
    const node = await until(async () => (await request(route)).nodes.find(node => node.key === key), node => Boolean(node.nova_mission_id));
    const mission = control.get(node.nova_mission_id);
    assert.equal(mission.metadata.parent.strategicBoard.schema, 'jaco.aura-strategic-board/v1');
    assert.equal(mission.metadata.parent.selectedMove.stepId, key);
    if (write) {
      const context = await readStrategicContext(mission, { seerUrl, token });
      assert.equal(context.fresh, true);
      assert.equal(context.board.activeObstacles[0].id, 'red-test');
      await execute(mission, { type: 'repo-read', data: { path: 'src/value.mjs' } });
      await execute(mission, { type: 'repo-write', data: { path: 'src/value.mjs', content: 'export const value = 2;\n' } });
    }
    const tested = await execute(mission, { type: 'repo-test', data: { command: 'node --test tests/value.test.mjs', kind: 'test' } });
    assert.equal(tested.ok, true);
    assert.match(tested.output, /fail 0/);
    const lease = control.claim(mission.id, 'nova-runtime-proof');
    const awaiting = control.release(mission.id, { owner: 'nova-runtime-proof', token: lease.token, completionProposed: true });
    assert.equal(awaiting.contractStatus.machineVerified, true);
    const reconciled = await request(`${route}/nodes/${key}/reconcile`, {});
    assert.equal(reconciled.outcome, 'verified');
    assert.equal(control.get(mission.id).status, 'DONE', 'pre-authorized work closes without a new operator approval');
    return reconciled;
  }
  await complete('repair', true);
  const afterRepair = await request(route + '/board');
  assert.equal(afterRepair.board.activeObstacles.length, 0);
  assert.equal(afterRepair.board.forecast.stepSuccess.repair, 1);
  assert.equal((await request(route + '/ready'))[0].key, 'deliver');
  await complete('deliver');
  await complete('polish');
  assert.deepEqual(dispatchOrder, ['repair', 'deliver', 'polish']);
  const done = await request(route);
  assert.equal(done.status, 'VERIFIED');
  assert.equal(done.strategic_board.progress, 1);
  assert.equal(done.strategic_board.forecast.terminalProbability, 1);
  assert.equal((await request('/cortex/strategic-board')).owner, 'seer');
  const content = fs.readFileSync(path.join(root, 'src/value.mjs'));
  t.diagnostic(`REAL_RESULT: initial test exit=${initialFailure}; repaired test exit=0; dispatch=${dispatchOrder.join(' -> ')}; graph=${done.status}; sha256=${createHash('sha256').update(content).digest('hex')}; model inference not exercised`);
});
