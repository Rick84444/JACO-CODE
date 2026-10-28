import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCognitiveCapsule, loadCognitiveCapsule, assertCognitiveCapsuleTask } from '../../agents/lib/cognitive-capsule.mjs';

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-capsule-test-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const mission = { id: 'mission-001', allowedTasks: ['repo-list', 'repo-edit', 'repo-read', 'shell', 'git-status'] };

test('no capsule preserves the existing runtime mission authority', () => fixture(dir => {
  const c = loadCognitiveCapsule(dir, { agentId: 'nova', mission });
  assert.equal(c.enabled, false);
  assert.deepEqual(c.allowedTasks, mission.allowedTasks);
}));

test('opt-in capsule can only attenuate, never grant, tools', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova', { tools: ['repo-list', 'git-status', 'mcp-call'] });
  const c = loadCognitiveCapsule(dir, { agentId: 'nova', mission });
  assert.deepEqual(c.allowedTasks, ['repo-list', 'git-status']);
  assert.ok(!c.allowedTasks.includes('mcp-call'));
  assert.throws(() => assertCognitiveCapsuleTask(dir, { agentId: 'nova', mission, task: 'repo-edit' }), /CAPSULE_TASK_NOT_ALLOWED/);
  assert.equal(assertCognitiveCapsuleTask(dir, { agentId: 'nova', mission, task: 'repo-list' }).enabled, true);
}));

test('rejects wrong agent binding and corrupt configuration', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova');
  assert.throws(() => loadCognitiveCapsule(dir, { agentId: 'neo', mission }), /CAPSULE_ID_OR_SCHEMA_MISMATCH/);
  fs.writeFileSync(path.join(dir, 'capsule.json'), '{invalid');
  assert.throws(() => loadCognitiveCapsule(dir, { agentId: 'nova', mission }), /CAPSULE_INVALID_JSON/);
}));

test('denials prevail and missing prompt fails closed', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova', { tools: ['repo-list', 'repo-read'] });
  const file = path.join(dir, 'capsule.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.tools.deny = ['repo-read'];
  fs.writeFileSync(file, JSON.stringify(cfg));
  assert.deepEqual(loadCognitiveCapsule(dir, { agentId: 'nova', mission }).allowedTasks, ['repo-list']);
  fs.unlinkSync(path.join(dir, 'prompts', 'IDENTITY.md'));
  assert.throws(() => loadCognitiveCapsule(dir, { agentId: 'nova', mission }), /CAPSULE_PROMPT_MISSING/);
}));

test('rejects symlinked prompt and oversized config', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova');
  const prompt = path.join(dir, 'prompts', 'IDENTITY.md');
  fs.unlinkSync(prompt);
  fs.symlinkSync(path.join(dir, 'capsule.json'), prompt);
  assert.throws(() => loadCognitiveCapsule(dir, { agentId: 'nova', mission }), /CAPSULE_SYMLINK_REJECTED/);
  fs.writeFileSync(path.join(dir, 'capsule.json'), 'x'.repeat(16385));
  assert.throws(() => loadCognitiveCapsule(dir, { agentId: 'nova', mission }), /CAPSULE_FILE_TOO_LARGE/);
}));

test('skill discovery is metadata-only and optional', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova');
  const skill = path.join(dir, 'skills', 'code-review');
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: code-review\ndescription: Reviews a patch for correctness.\n---\n# Code review\nDo not execute unless selected.');
  const c = loadCognitiveCapsule(dir, { agentId: 'nova', mission });
  assert.deepEqual(c.skills, [{ name: 'code-review', description: 'Reviews a patch for correctness.' }]);
}));

test('memory is loaded by existing agent home, under explicit request', () => fixture(dir => {
  initCognitiveCapsule(dir, 'nova');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), 'Known issue: stale release build.');
  const c = loadCognitiveCapsule(dir, { agentId: 'nova', mission, withMemory: true });
  assert.match(c.home.text, /stale release build/);
}));
