import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTIVE_REPAIR_SCHEMA,
  buildAdaptiveRepairPacket,
  classifyRepairFailure,
  formatAdaptiveRepairPacket,
} from '../../agents/lib/adaptive-repair.mjs';

const mission = allowedTasks => ({ id: 'm-adaptive', allowedTasks });

test('an executed test failure produces inspect-then-patch hypotheses inside the contract', () => {
  const packet = buildAdaptiveRepairPacket({
    mission: mission(['repo-test', 'repo-read', 'git-diff', 'repo-edit']),
    task: { type: 'repo-test' },
    receipt: { ok: false, error: 'AssertionError: expected HTTP 200' },
    history: [{ type: 'repo-test', ok: false, error: 'AssertionError: expected HTTP 200' }],
  });
  assert.equal(packet.schema, ADAPTIVE_REPAIR_SCHEMA);
  assert.equal(packet.observation.source, 'executed_tool_receipt');
  assert.equal(packet.observation.failureClass, 'TEST_FAILURE');
  assert.deepEqual(packet.candidates.map(c => c.tool), ['repo-read', 'git-diff', 'repo-edit']);
  assert.match(packet.candidates.at(-1).probe, /Only after inspecting evidence/);
  assert.equal(packet.verified, false);
  assert.match(formatAdaptiveRepairPacket(packet), /AURA_ADAPTIVE_REPAIR/);
});

test('missing files are diagnosed using only permitted tools, not a scope escape', () => {
  const packet = buildAdaptiveRepairPacket({
    mission: mission(['repo-list', 'repo-test', 'shell']),
    task: { type: 'repo-test' },
    receipt: { ok: false, error: 'ENOENT /private/secret.txt' },
    history: [],
  });
  assert.equal(packet.observation.failureClass, 'MISSING_PATH');
  assert.deepEqual(packet.candidates.map(c => c.tool), ['repo-list']);
  assert.ok(packet.candidates.every(c => mission(['repo-list']).allowedTasks.includes(c.tool)));
  assert.doesNotMatch(formatAdaptiveRepairPacket(packet), /suggest.*shell/i);
});

test('uncertain effects are reconciled even if the API acknowledged the call', () => {
  const packet = buildAdaptiveRepairPacket({
    mission: mission(['repo-edit', 'repo-write', 'git-status', 'git-diff', 'repo-read']),
    task: { type: 'repo-edit' },
    receipt: { ok: true, verified: false, outcomeUnknown: true, error: 'Transport timed out' },
  });
  assert.equal(packet.mode, 'RECONCILE_FIRST');
  assert.equal(packet.observation.failureClass, 'UNKNOWN_OUTCOME');
  assert.deepEqual(packet.candidates.map(c => c.tool), ['git-status', 'git-diff', 'repo-read']);
  assert.match(packet.conclusionRule, /Do not retry the mutation/);
  assert.ok(!packet.candidates.some(c => c.tool === 'repo-edit' || c.tool === 'repo-write'));
});

test('permission denial is a typed blocker, never a request for bypass', () => {
  const packet = buildAdaptiveRepairPacket({
    mission: mission(['repo-read', 'shell', 'git-status']),
    task: { type: 'mcp-write' },
    receipt: { ok: false, error: 'OPERATOR_APPROVAL_REQUIRED: policy deny' },
  });
  assert.equal(packet.mode, 'OPERATOR_OR_SCOPE_REQUIRED');
  assert.equal(packet.observation.failureClass, 'AUTHORITY');
  assert.deepEqual(packet.candidates.map(c => c.tool), ['repo-read', 'git-status']);
  assert.match(packet.conclusionRule, /Do not bypass/);
});

test('repeated failures trigger a different approach, but never an autonomous permission change', () => {
  const input = {
    mission: mission(['health-check', 'repo-test']),
    task: { type: 'repo-test' },
    receipt: { ok: false, error: 'AssertionError: still failing' },
    history: [
      { type: 'repo-test', ok: false, error: 'AssertionError: first failure' },
      { type: 'repo-test', ok: false, error: 'AssertionError: still failing' },
    ],
  };
  const packet = buildAdaptiveRepairPacket(input);
  assert.equal(packet.mode, 'CHANGE_STRATEGY');
  assert.equal(packet.observation.sameClassFailuresForTool, 2);
  assert.deepEqual(packet.candidates, []);
  assert.match(packet.conclusionRule, /report a blocker/);
  assert.match(packet.authority, /existing mission contract/);
});

test('success and missing evidence produce no speculative repair request', () => {
  assert.equal(buildAdaptiveRepairPacket({ mission: mission(['repo-read']), task: { type: 'repo-read' }, receipt: { ok: true, verified: true } }), null);
  assert.equal(buildAdaptiveRepairPacket({ mission: mission(['repo-read']), task: { type: 'repo-read' } }), null);
  assert.equal(classifyRepairFailure({ type: 'repo-test' }, { error: 'ENOENT' }), 'MISSING_PATH');
  assert.throws(() => formatAdaptiveRepairPacket({ schema: 'other' }), /INVALID/);
});
