// Inside a coding contract the operator books in advance which outward actions are free. Booked kinds do
// not stop the mission; hard limits stop it no matter what the contract says; outside a contract nothing
// changes. Ids are fixed: an unknown id is dropped, never widened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorApprovalCheck, categoryOf, PRE_APPROVABLE } from '../../agents/lib/operator-action-guard.mjs';
import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';

const merge = { type: 'shell', data: { command: 'gh pr merge 12 --squash' } };
const publish = { type: 'shell', data: { command: 'npm publish' } };
const forcePush = { type: 'shell', data: { command: 'git push --force origin feat' } };
const repoDelete = { type: 'shell', data: { command: 'gh repo delete owner/x --yes' } };
const outward = { type: 'mcp-write', data: { server: 'jaco', tool: 'jaco_wordpress_update' } };
const ALL = Object.keys(PRE_APPROVABLE);

test('a booked kind inside a contract does not stop the mission', () => {
  assert.equal(operatorApprovalCheck(merge, { sandbox: true, preApproved: ['merge-or-release'] }), null);
  assert.equal(operatorApprovalCheck(publish, { sandbox: true, preApproved: ['publish-or-deploy'] }), null);
  assert.equal(operatorApprovalCheck(outward, { sandbox: true, preApproved: ['external-write'] }), null);
});

test('an unbooked kind still stops the mission inside a contract', () => {
  assert.ok(operatorApprovalCheck(merge, { sandbox: true, preApproved: [] }));
  assert.ok(operatorApprovalCheck(publish, { sandbox: true, preApproved: ['merge-or-release'] }));
});

test('hard limits stop the mission whatever is booked', () => {
  assert.ok(operatorApprovalCheck(forcePush, { sandbox: true, preApproved: ALL }), 'force-push');
  assert.ok(operatorApprovalCheck(repoDelete, { sandbox: true, preApproved: ALL }), 'repository delete');
  assert.equal(categoryOf('force-push rewrites shared history'), 'HARD');
  assert.equal(categoryOf('GitHub repository delete'), 'HARD');
});

test('outside a contract pre-approval has no effect', () => {
  assert.ok(operatorApprovalCheck(merge, { sandbox: false, preApproved: ['merge-or-release'] }));
});

test('categories map from the guard reasons', () => {
  assert.equal(categoryOf('GitHub merge or release'), 'merge-or-release');
  assert.equal(categoryOf('publish or deploy'), 'publish-or-deploy');
  assert.equal(categoryOf('external write jaco.jaco_wordpress_update'), 'external-write');
  assert.equal(categoryOf('push directly to a protected branch'), 'push-protected-branch');
});

test('the contract keeps only known pre-approval ids and rejects a malformed list', () => {
  const c = normalizeCodingContract({ objective: 'Fix tests', scope: { allowed: ['src/**'] }, acceptance: ['tests pass'],
    preApproved: ['merge-or-release', 'delete-everything', 'merge-or-release'] });
  assert.deepEqual(c.preApproved, ['merge-or-release']);
  assert.throws(() => normalizeCodingContract({ objective: 'x', scope: { allowed: ['src/**'] }, acceptance: ['a'], preApproved: 'all' }), /CODING_PREAPPROVAL_INVALID/);
});
