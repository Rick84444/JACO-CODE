import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createWorkbenchProjectBinding } from '../../runtime/src/server/workbenchProjectBinding.mjs';
const root = path.resolve('project-a');
function check(expected, current = root) {
  let code, body, passed = false;
  const req = { headers: expected === undefined ? {} : { 'x-jaco-project-root': expected } };
  const res = { status(n) { code = n; return this; }, json(value) { body = value; } };
  createWorkbenchProjectBinding({ get: () => current })(req, res, () => { passed = true; });
  return { code, body, passed };
}
test('GUI without binding and matching MCP project remain compatible', () => {
  assert.equal(check(undefined).passed, true);
  assert.equal(check(root).passed, true);
  assert.equal(check(path.join(root, '.')).passed, true);
});
test('project switch rejects stale MCP binding before route execution', () => {
  const out = check(root, path.resolve('project-b'));
  assert.equal(out.code, 409); assert.equal(out.passed, false);
  assert.equal(out.body.error, 'WORKBENCH_PROJECT_CONFLICT');
});
test('malformed bindings fail closed', () => {
  for (const value of ['', 'relative', ['a','b'], root + '\0']) {
    assert.equal(check(value).code, 400);
    assert.equal(check(value).passed, false);
  }
});
