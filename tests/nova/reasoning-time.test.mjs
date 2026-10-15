import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { novaTiming, planningDeadline } from '../../agents/lib/nova-timing.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';

test('invalid and contradictory timing fails closed', () => {
  for (const value of ['NaN', '-1', 'Infinity', '3.5', '3600001']) {
    assert.throws(() => novaTiming({ JACO_NOVA_REASONING_TIMEOUT_MS: value }), /INVALID_TIMING/);
  }
  assert.throws(() => novaTiming({ JACO_NOVA_REASONING_TIMEOUT_MS: '600000', JACO_NOVA_PLAN_BUDGET_MS: '300000' }), /EXCEEDS/);
  assert.equal(planningDeadline({ planningDeadlineAt: 400_000 }, novaTiming({}), 100_000), 370_000);
});

test('long reasoning retains sole ownership; expired planning recovers without executing twice', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-reasoning-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let now = 100_000;
  const control = new NovaMissionControl(bus, { now: () => now, allowedTasks: ['health-check', 'browser-click'] });
  const mission = control.create({ goal: 'Check health after reasoning', idempotencyKey: 'long-reasoning' });
  const claimed = control.claim(mission.id, 'nova-a');
  now += 600_000;
  assert.throws(() => control.claim(mission.id, 'nova-b'), /BUSY/);
  // A step with an effect: if its lease expires, its outcome is uncertain.
  const action = control.begin(mission.id, { owner: 'nova-a', token: claimed.token, task: { type: 'browser-click', data: { name: 'Save' } } });
  assert.ok(action.id);
  // Execution timeout stays bounded at five minutes and quarantines uncertain effects.
  now += 300_001;
  control.recoverExpired();
  assert.equal(control.get(mission.id).phase, 'INTERRUPTED');
  assert.equal(control.get(mission.id).status, 'BLOCKED');
  assert.throws(() => control.claim(mission.id, 'nova-b'), /MISSION_NOT_CURRENT|BLOCKED/);
});
