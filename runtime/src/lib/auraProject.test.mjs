import test from 'node:test';
import assert from 'node:assert/strict';

import { canSwitchProject, isAbsoluteProjectPath, projectLabel } from './auraProject.mjs';

test('valid paths', () => {
  assert.equal(isAbsoluteProjectPath('C:\\code\\my-app'), true);
  assert.equal(isAbsoluteProjectPath('C:/code/my-app'), true);
  assert.equal(isAbsoluteProjectPath('d:\\work\\repo'), true);
  assert.equal(isAbsoluteProjectPath('\\\\server\\share\\repo'), true);
  assert.equal(isAbsoluteProjectPath('/home/u/repo'), true);
  assert.equal(isAbsoluteProjectPath('  /home/u/repo  '), true);
});

test('labels', () => {
  assert.equal(projectLabel('C:\\code\\my-app\\'), 'my-app');
  assert.equal(projectLabel('/home/u/repo'), 'repo');
  assert.equal(projectLabel(''), 'No project');
});

test('switching project needs clean drafts', () => {
  assert.equal(canSwitchProject({}), true);
  assert.equal(canSwitchProject({ a: 'x' }), false);
});

test('invalid paths', () => {
  assert.equal(isAbsoluteProjectPath(''), false);
  assert.equal(isAbsoluteProjectPath('   '), false);
  assert.equal(isAbsoluteProjectPath('relative/dir'), false);
  assert.equal(isAbsoluteProjectPath('C:relative'), false);
  assert.equal(isAbsoluteProjectPath('/home/u/' + String.fromCharCode(0) + 'repo'), false);
  assert.equal(isAbsoluteProjectPath(null), false);
  assert.equal(isAbsoluteProjectPath(42), false);
});
