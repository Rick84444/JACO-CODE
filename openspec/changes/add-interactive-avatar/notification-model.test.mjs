import test from 'node:test';
import assert from 'node:assert/strict';
import {experiment, measure} from './notification-model.mjs';
test('independent oracle detects duplicate, omitted and unexpected output', () => {
  assert.deepEqual(measure(['a','b'], ['a','a','x']), {duplicates:1, unexpected:1, missed:1});
});
test('paired seeds produce deterministic outcomes', () => {
  assert.deepEqual(experiment(42), experiment(42));
  for (const seed of [42,73, 0, 0xffffffff]) {
    const r = experiment(seed);
    assert.equal(r.baselineDuplicates, r.deliveries - 20000);
    assert.ok(r.baselineDuplicates > 0);
    assert.deepEqual([r.deduplicatedDuplicates,r.missed,r.unexpected], [0,0,0]);
  }
});
test('negative control: pass-through consumer must fail deduplication', () => {
  const r = experiment(42, 100, ids => ids);
  assert.ok(r.deduplicatedDuplicates > 0);
  assert.equal(r.deduplicatedDuplicates, r.baselineDuplicates);
});
test('negative control: empty output must fail completeness', () => {
  assert.equal(experiment(42, 1, () => []).missed, 20);
});
test('negative control: hallucinated output must be detected', () => {
  assert.equal(experiment(42, 1, ids => [...new Set(ids), 'unknown']).unexpected, 1);
});
