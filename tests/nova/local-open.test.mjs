import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveOpenTarget, explorerArgs } from '../../agents/lib/local-open.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-root-'));
const project = path.join(base, 'project');
fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
fs.writeFileSync(path.join(project, 'docs', 'a.md'), 'x');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'open-outside-'));
test.after(() => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

test('a folder inside an allowed root opens as a folder', () => {
  const t = resolveOpenTarget(path.join(project, 'docs'), [project]);
  assert.equal(t.mode, 'folder');
  assert.deepEqual(explorerArgs(t), [t.path]);
});

test('a file inside an allowed root is selected in its folder', () => {
  const t = resolveOpenTarget(path.join(project, 'docs', 'a.md'), [project]);
  assert.equal(t.mode, 'select');
  assert.equal(explorerArgs(t)[0], '/select,' + t.path);
});

test('a path outside every allowed root is refused', () => {
  assert.throws(() => resolveOpenTarget(outside, [project]), /OPEN_PATH_OUTSIDE_ALLOWED_ROOTS/);
});

test('a missing path, a null byte and an empty root list are refused', () => {
  assert.throws(() => resolveOpenTarget(path.join(project, 'nope'), [project]), /OPEN_PATH_NOT_FOUND/);
  assert.throws(() => resolveOpenTarget('a\0b', [project]), /OPEN_PATH_INVALID/);
  assert.throws(() => resolveOpenTarget(project, []), /OPEN_ROOTS_MISSING/);
});

test('a link inside the project that points outside is refused', () => {
  const link = path.join(project, 'escape');
  try { fs.symlinkSync(outside, link, 'junction'); } catch { return; }
  assert.throws(() => resolveOpenTarget(link, [project]), /OPEN_PATH_OUTSIDE_ALLOWED_ROOTS/);
});
