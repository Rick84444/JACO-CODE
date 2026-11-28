// 2026-11-28: the planar floor reflection switched on and off with every quality-tier flicker while she walked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReflectionGate } from '../../runtime/src/lib/auraStudioFloor.mjs';

test('a short quality dip keeps the reflection; a lasting one or leaving the wide view turns it off', () => {
  const gate = createReflectionGate({ hold: 3 });
  for (let i = 0; i < 44; i++) assert.equal(gate.update({ wide: 1, quality: 1, mobile: false, capable: true }, 1 / 30), false, 'waits for the first frames');
  assert.equal(gate.update({ wide: 1, quality: 1, mobile: false, capable: true }, 1 / 30), true);
  for (let i = 0; i < 60; i++) assert.equal(gate.update({ wide: 1, quality: 0, mobile: false, capable: true }, 1 / 30), true, 'two seconds of dip');
  for (let i = 0; i < 40; i++) gate.update({ wide: 1, quality: 0, mobile: false, capable: true }, 1 / 30);
  assert.equal(gate.update({ wide: 1, quality: 0, mobile: false, capable: true }, 1 / 30), false, 'over three seconds');
  assert.equal(gate.update({ wide: 1, quality: 1, mobile: false, capable: true }, 1 / 30), true);
  assert.equal(gate.update({ wide: .2, quality: 1, mobile: false, capable: true }, 1 / 30), false, 'portrait view: off at once');
  assert.equal(createReflectionGate({ warmup: 0 }).update({ wide: 1, quality: 1, mobile: true, capable: true }, .03), false, 'never on mobile');
});
