// Real SEER process over HTTP: stopping a graph must not end its strategic goal (2026-10-31: cancelling
// an A2A task from Aura also cancelled the operator's Aura goal). Ending the goal is a separate decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function until(read, accept, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('RUNTIME_RESULT_TIMEOUT');
}

test('cancelling a graph keeps its goal; the goal ends only on an explicit, confirmed cancel', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-seer-goal-cancel-'));
  const token = 'seer-goal-cancel-test-1234567890abcdef';
  const child = spawn(process.execPath, ['gateway/src/seer.mjs'], {
    env: { PATH: process.env.PATH, SEER_PORT: '0', SEER_STATE_DIR: path.join(root, 'seer'),
      JACO_GATEWAY_TOKEN: token, JACO_RUNTIME_URL: 'http://127.0.0.1:9',
      JACO_WORKPLACE_REQUIRED: '0', JACO_WORKPLACE_URL: 'http://127.0.0.1:9',
      SEER_AUTONOMY_LOOP_MS: '0', SEER_GOVERNOR_INTERVAL_MS: '0', A2ACOLONY_SYNC_INTERVAL_MS: '0',
      JACO_ALLOW_PAID_MODELS: '0', JACO_LITERT_URL: 'http://127.0.0.1:9/v1', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      JACO_SEER_MODEL_DISCOVERY_TIMEOUT_MS: '100',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill(); await exited; fs.rmSync(root, { recursive: true, force: true }); });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const port = await until(() => /JACO_SEER_LISTENING port=(\d+)/.exec(output)?.[1], Boolean);
  const call = async (route, payload) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: payload ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const goalStatus = async id => (await call('/cortex/strategy/goals?status=')).data.find(goal => goal.id === id)?.status;
  const graphFor = async (goalId, title) => (await call('/cortex/mission-graphs', { title, objective: title,
    policy: { strategic_goal_id: goalId, allowedTasks: ['health-check'] },
    nodes: [{ key: 'observe', objective: 'Observe the runtime' }] })).data;

  const goal = (await call('/cortex/strategy/goals', { statement: 'Observe the local runtime', horizon: 'short' })).data;
  const first = await graphFor(goal.id, 'Off-target work');
  const stopped = await call(`/cortex/mission-graphs/${first.id}/cancel`, { reason: 'stop this work only' });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.data.status, 'CANCELLED');
  assert.equal(await goalStatus(goal.id), 'active', 'stopping a graph must not end its goal');

  const second = await graphFor(goal.id, 'Next attempt');
  const unconfirmed = await call(`/cortex/strategy/goals/${goal.id}/cancel`, { reason: 'end it' });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.data.error, 'GOAL_CANCEL_CONFIRM_REQUIRED');
  assert.equal(await goalStatus(goal.id), 'active');

  const ended = await call(`/cortex/strategy/goals/${goal.id}/cancel`, { confirm: true, reason: 'operator ends the goal' });
  assert.equal(ended.status, 200);
  assert.equal(ended.data.goal.status, 'cancelled');
  assert.deepEqual(ended.data.cancelledGraphs, [second.id]);
  assert.equal((await call(`/cortex/mission-graphs/${second.id}`)).data.status, 'CANCELLED');
});
