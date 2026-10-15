// Found live 2026-09-29: a mission whose goal needed repo-write, which wasn't in mission.allowedTasks
// (no coding contract was supplied), got a planner that substituted an unrelated browser action
// instead of declining -- the mission sat BLOCKED with a confusing, unrelated GitHub-page receipt.
// This covers the fix: a planner may now return {blocked:true, reason} and processMissionTurn must
// release the mission with that reason, never call execute(), and never fabricate a task.
import test from 'node:test';
import assert from 'node:assert/strict';
import { processMissionTurn } from '../../agents/lib/mission-client.mjs';

function makeClient({ mission }) {
  const calls = { release: [], begin: [], finish: [] };
  return {
    calls,
    async current() { return mission; },
    async claim(id, owner) { return { mission, token: 'tok-1' }; },
    async release(id, input) { calls.release.push(input); return { ok: true }; },
    async begin(id, input) { calls.begin.push(input); return { id: 'task-1', ...input.task }; },
    async finish(id, input) { calls.finish.push(input); return mission; },
  };
}

test('a planner that declines (blocked:true) releases the mission with the reason and never executes anything', async () => {
  const mission = { id: 'm-1', status: 'ACTIVE', goal: 'write a local file', allowedTasks: ['browser-survey-site', 'browser-click'] };
  const client = makeClient({ mission });
  let executed = false;

  const result = await processMissionTurn({
    client,
    owner: 'nova-test',
    plan: async () => ({ blocked: true, reason: 'repo-write is not in mission.allowedTasks; no other task can write a file' }),
    execute: async () => { executed = true; return { ok: true }; },
  });

  assert.equal(executed, false, 'execute() must never run for a declined plan');
  assert.equal(result.executed, false);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /repo-write/);
  assert.equal(client.calls.release.length, 1);
  assert.match(client.calls.release[0].error, /^PLANNER_BLOCKED:/);
  assert.match(client.calls.release[0].error, /repo-write/);
  assert.equal(client.calls.begin.length, 0, 'begin() must never be called for a declined plan');
});

test('no available planner defers the turn: lease released without error, nothing executed', async () => {
  // Live 2026-09-30: a filler detect-surfaces ran whenever every model was rate-limited and used
  // 4 of a coding mission's 12 steps.
  const mission = { id: 'm-3', status: 'ACTIVE', goal: 'fix a test', allowedTasks: ['repo-read'] };
  const client = makeClient({ mission });
  let executed = false;
  const result = await processMissionTurn({ client, owner: 'nova-test',
    plan: async () => ({ deferred: true, reason: 'NO_PLANNER_AVAILABLE' }),
    execute: async () => { executed = true; return { ok: true }; } });
  assert.equal(executed, false);
  assert.equal(result.deferred, true);
  assert.equal(client.calls.begin.length, 0);
  assert.equal(client.calls.release.length, 1);
  assert.equal(client.calls.release[0].error, undefined, 'a deferral must not count as a mission failure');
});

test('a planner that omits blocked/complete/task still fails loudly (NO_NEXT_TASK), not silently', async () => {
  const mission = { id: 'm-2', status: 'ACTIVE', goal: 'do something', allowedTasks: [] };
  const client = makeClient({ mission });

  await assert.rejects(
    () => processMissionTurn({ client, owner: 'nova-test', plan: async () => ({}), execute: async () => ({ ok: true }) }),
    /NO_NEXT_TASK/,
  );
  assert.equal(client.calls.release.length, 1, 'the failed claim must still be released, not leaked');
});
