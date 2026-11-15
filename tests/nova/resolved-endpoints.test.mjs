import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvedLocalPort, localServiceUrl } from '../../agents/lib/resolved-endpoints.mjs';
import { classifyToolFailure } from '../../agents/lib/tool-failure-diagnosis.mjs';

const file = JSON.stringify({ schema: 'jaco.resolved-ports/v1', ports: { runtime: { requested: 3000, port: 3001 } } });
const opts = { roots: ['/data'], read: p => { if (p === path.join('/data', '.jaco', 'state', 'resolved-ports.json')) return file; throw new Error('ENOENT'); } };

test('processes outside the launcher follow a runtime that was moved off its default port', () => {
  assert.equal(resolvedLocalPort('runtime', {}, opts), 3001);
  assert.equal(localServiceUrl('runtime', {}, opts), 'http://127.0.0.1:3001');
  assert.equal(localServiceUrl('workplace', {}, opts), 'http://127.0.0.1:2995');
});

test('an explicit URL wins, and a changed requested port ignores an old resolution', () => {
  assert.equal(localServiceUrl('runtime', { JACO_RUNTIME_URL: 'http://127.0.0.1:4000/' }, opts), 'http://127.0.0.1:4000');
  assert.equal(resolvedLocalPort('runtime', { PORT: '3500' }, opts), 3500);
});

test('without a resolution file the defaults are used', () => {
  assert.equal(localServiceUrl('runtime', {}, { roots: ['/none'], read: () => { throw new Error('ENOENT'); } }), 'http://127.0.0.1:3000');
});

test('a missing file is a path problem, not a missing command', () => {
  assert.equal(classifyToolFailure("ENOENT: no such file or directory, open 'src/x.ts'").kind, 'PATH_NOT_FOUND');
  assert.equal(classifyToolFailure('spawn uvx ENOENT').kind, 'COMMAND_MISSING');
  assert.equal(classifyToolFailure('MCP_SERVER_SPAWN_FAILED:gitx:ENOENT').kind, 'COMMAND_MISSING');
});
