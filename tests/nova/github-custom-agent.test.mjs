import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = '.github/agents/aura.agent.md';

// Helper to normalize line endings for regex matching
const normalize = (s) => s.replace(/\r\n/g, '\n');

test('Aura is the single GitHub Copilot repository custom agent', () => {
  const text = fs.readFileSync(file, 'utf8');
  const norm = normalize(text);
  assert.match(norm, /^---\n[\s\S]*?\n---\n/);
  assert.match(norm, /\nname:\s*Aura\n/);
  assert.match(norm, /\ndescription:\s*.+\n/);
  assert.match(norm, /\ntarget:\s*github-copilot\n/);
  assert.match(norm, /\nuser-invocable:\s*true\n/);
  assert.match(norm, /\ndisable-model-invocation:\s*false\n/);
  assert.match(norm, /tools:\s*\[[^\]]*"read"[^\]]*"search"[^\]]*"edit"[^\]]*"execute"[^\]]*\]/);
});

test('Aura Git engineering profile preserves truthful JACO execution boundaries', () => {
  const text = fs.readFileSync(file, 'utf8');
  const norm = normalize(text);
  for (const required of [
    'DEGRADED_UNSYNCED',
    'jaco.coding-contract/v1',
    'target-host verification',
    'ContinuumRuntime',
    'Aura owns the operator-facing goal',
    'Never force-push protected branches',
  ]) {
    assert.equal(norm.includes(required), true, 'missing Aura boundary: ' + required);
  }
});

test('legacy independent agent/persona definitions do not coexist with Aura', () => {
  assert.equal(fs.existsSync('.github/agents/nova.agent.md'), false);
  assert.equal(fs.existsSync('agents/workflows/seer-operating-contract.md'), false);
  const current = normalize(fs.readFileSync(file, 'utf8'));
  assert.match(current, /jaco-agent:\s*"aura"/);
  assert.match(current, /not a second JACO runtime agent/);
  assert.match(current, /historical Nova service is an Aura execution function/);
});
