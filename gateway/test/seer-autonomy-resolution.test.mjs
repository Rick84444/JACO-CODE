import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-seer-resolution-'));
  const bus = new DurableMissionBus(root);
  const control = new NovaMissionControl(bus, { allowedTasks: ['health-check'] });
  t.after(() => {
    bus.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { control };
}

function moveToAwaiting(control, source) {
  const mission = control.create({
    goal: 'Verify a safe read-only mission',
    idempotencyKey: 'resolution-' + source + '-' + Math.random().toString(36).slice(2),
    source,
    allowedTasks: ['health-check'],
  });

  let lease = control.claim(mission.id, 'nova-resolution-test');
  const action = control.begin(mission.id, {
    owner: 'nova-resolution-test',
    token: lease.token,
    task: { type: 'health-check', data: {}, expectedOutcome: 'health observed' },
  });
  control.finish(mission.id, {
    owner: 'nova-resolution-test',
    token: lease.token,
    actionId: action.id,
    receipt: {
      ok: true,
      verified: true,
      outcomeUnknown: false,
      observation: { healthy: true },
    },
  });

  lease = control.claim(mission.id, 'nova-resolution-test');
  const awaiting = control.release(mission.id, {
    owner: 'nova-resolution-test',
    token: lease.token,
    completionProposed: true,
  });
  assert.equal(awaiting.status, 'AWAITING_VERIFICATION');
  return awaiting;
}

test('SEER may confirm only a verified seer-mission-graph mission', t => {
  const { control } = fixture(t);
  const awaiting = moveToAwaiting(control, 'seer-mission-graph');

  const done = control.resolve(awaiting.id, {
    decision: 'confirm',
    authority: 'seer',
    note: 'machine verified closed-loop evidence',
  });

  assert.equal(done.status, 'DONE');
  assert.equal(done.phase, 'CLOSED');
});

test('SEER cannot claim operator-created missions', t => {
  const { control } = fixture(t);
  const awaiting = moveToAwaiting(control, 'operator');

  assert.throws(() => control.resolve(awaiting.id, {
    decision: 'confirm',
    authority: 'seer',
    note: 'must not cross authority boundary',
  }), /SEER_RESOLUTION_SOURCE_REQUIRED/);

  assert.equal(control.get(awaiting.id).status, 'AWAITING_VERIFICATION');
});

test('operator confirmation remains valid', t => {
  const { control } = fixture(t);
  const awaiting = moveToAwaiting(control, 'operator');

  const done = control.resolve(awaiting.id, {
    decision: 'confirm',
    authority: 'operator',
    note: 'operator verified',
  });

  assert.equal(done.status, 'DONE');
});
