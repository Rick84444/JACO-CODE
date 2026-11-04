import test from 'node:test';
import assert from 'node:assert/strict';
import { relevantAuthorizedSkills } from '../../agents/lib/skills.mjs';
import { contextPacketIntro } from '../../agents/lib/agent-loop.mjs';

const catalog = [
  { id: 'http-retry', description: 'Reliable HTTP client retry and error handling', tasks: ['repo-read', 'repo-edit', 'repo-test'] },
  { id: 'http-deploy', description: 'Deploy HTTP client to production', tasks: ['shell', 'repo-read'] },
  { id: 'docs-review', description: 'Review technical documentation', tasks: ['repo-read'] },
  { id: 'wrong-scope', description: 'HTTP client inspection', tasks: ['repo-read', 'git-push'] },
];

test('native skill matching ranks relevant installed skills but never offers unauthorized task scopes', () => {
  const list = relevantAuthorizedSkills(catalog, ['repo-read', 'repo-edit', 'repo-test', 'skill-load'], 'Fix the HTTP client retry behavior');
  assert.deepEqual(list.map(s => s.id), ['http-retry']);
  assert.deepEqual(list[0].tasks, ['repo-read', 'repo-edit', 'repo-test']);
});

test('native skill matching does not invent a permission when no skill fits', () => {
  assert.deepEqual(relevantAuthorizedSkills(catalog, ['repo-read'], 'Repair HTTP retry'), []);
  assert.deepEqual(relevantAuthorizedSkills(catalog, ['repo-read', 'repo-edit', 'repo-test'], 'Unrelated task'), []);
});

test('native context packet labels a catalog candidate as not activated', () => {
  const intro = contextPacketIntro({ id: 'm-1', goal: 'Fix HTTP retry', allowedTasks: ['skill-load', 'repo-read'] },
    { skillCandidates: 'http-retry: Reliable HTTP client (declared tasks: repo-read)' });
  assert.match(intro, /Authorized skill candidates/);
  assert.match(intro, /use skill-load to read instructions/);
  assert.match(intro, /never widen the mission/);
  assert.match(intro, /http-retry/);
});
