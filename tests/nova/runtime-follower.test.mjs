import test from 'node:test';
import assert from 'node:assert/strict';
import { followResolvedRuntime } from '../../agents/lib/resolved-endpoints.mjs';

const file = port => JSON.stringify({ schema: 'jaco.resolved-ports/v1', ports: { runtime: { requested: 3000, port } } });
const store = () => {
  let content = null;
  return {
    set: c => { content = c; },
    read: p => { if (p.endsWith('resolved-ports.json') && content) return content; throw new Error('ENOENT'); },
  };
};

test('a process started before Core moved follows it without a restart', () => {
  const env = { JACO_RUNTIME_URL: 'http://127.0.0.1:3000', JACO_BASE_URL: 'http://127.0.0.1:3000', PORT: '3000' };
  const s = store();
  const seen = [];
  const f = followResolvedRuntime(env, { intervalMs: 0, roots: ['/d'], read: s.read, onChange: u => seen.push(u) });
  assert.equal(env.JACO_RUNTIME_URL, 'http://127.0.0.1:3000', 'nothing to do before a move');
  s.set(file(3001));
  assert.equal(f.check(), true);
  assert.equal(env.JACO_RUNTIME_URL, 'http://127.0.0.1:3001');
  assert.equal(env.JACO_BASE_URL, 'http://127.0.0.1:3001');
  assert.equal(env.PORT, '3001');
  assert.deepEqual(seen, ['http://127.0.0.1:3001']);
  assert.equal(f.check(), false, 'no further change once followed');
  f.stop();
});

test('an address the operator pinned elsewhere is never rewritten', () => {
  const env = { JACO_RUNTIME_URL: 'https://jaco.example.org', PORT: '3000' };
  const s = store();
  s.set(file(3001));
  const f = followResolvedRuntime(env, { intervalMs: 0, roots: ['/d'], read: s.read });
  assert.equal(env.JACO_RUNTIME_URL, 'https://jaco.example.org');
  f.stop();
});

test('without a resolution the environment is untouched', () => {
  const env = { JACO_RUNTIME_URL: 'http://127.0.0.1:3000' };
  const f = followResolvedRuntime(env, { intervalMs: 0, roots: ['/none'], read: () => { throw new Error('ENOENT'); } });
  assert.equal(env.JACO_RUNTIME_URL, 'http://127.0.0.1:3000');
  f.stop();
});
