import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = '.github/agents/nova.agent.md';

// Helper to normalize line endings for regex matching
const normalize = (s) => s.replace(/\r\n/g, '\n');

test('Nova is exposed as a GitHub Copilot repository custom agent', () => {
  const text = fs.readFileSync(file, 'utf8');
  const norm = normalize(text);
  assert.match(norm, /^---\n[\s\S]*?\n---\n/);
  assert.match(norm, /\nname:\s*Nova\n/);
  assert.match(norm, /\ndescription:\s*.+\n/);
  assert.match(norm, /\ntarget:\s*github-copilot\n/);
  assert.match(norm, /\nuser-invocable:\s*true\n/);
  assert.match(norm, /\ndisable-model-invocation:\s*false\n/);
  assert.match(norm, /tools:\s*\[[^\]]*"read"[^\]]*"search"[^\]]*"edit"[^\]]*"execute"[^\]]*\]/);
});

test('Nova Git agent preserves truthful JACO execution boundaries', () => {
  const text = fs.readFileSync(file, 'utf8');
  const norm = normalize(text);
  for (const required of [
    'DEGRADED_UNSYNCED',
    'jaco.coding-contract/v1',
    'target-host verification',
    'ContinuumRuntime',
    'SEER owns strategy/mission authority',
    'Never force-push protected branches',
  ]) {
    assert.equal(norm.includes(required), true, 'missing Nova boundary: ' + required);
  }
});
