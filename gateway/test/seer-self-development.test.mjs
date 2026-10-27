import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfDevelopmentGraph, SELF_DEVELOPMENT_SCHEMA, selfDevelopmentProtectedPaths } from '../src/seer-self-development.mjs';

test('self-development graph binds code mutation to a normalized coding contract', () => {
  const graph = buildSelfDevelopmentGraph({
    objective: 'Improve SEER diagnostics without weakening verification',
    scope: { allowed: ['gateway/src/diagnostics/**'] },
    acceptance: ['diagnostics tests pass', 'no regression in SEER startup'],
    verification: { commands: ['npm test', 'node --check gateway/src/seer.mjs'] },
  });

  assert.equal(graph.policy.schema, SELF_DEVELOPMENT_SCHEMA);
  assert.equal(graph.policy.release, 'verified-autonomous');
  assert.equal(graph.policy.autonomy, 'closed-loop');
  assert.equal(graph.policy.git_push, true);
  assert.equal(graph.policy.deploy, true);
  assert.equal(graph.policy.operator_confirmation_required_for_release, false);
  assert.equal(graph.policy.outgoing_financial_commitment_requires_operator_approval, true);
  assert.equal(graph.nodes.length, 1);

  const contract = graph.nodes[0].contract;
  assert.equal(contract.schema, 'jaco.coding-contract/v1');
  assert.equal(contract.execution.autonomous, true);
  assert.equal(contract.execution.allow_git_commit, true);
  assert.equal(contract.execution.allow_git_push, true);
  assert.equal(contract.execution.allow_git_merge, true);
  assert.equal(contract.execution.require_human_before_destructive_action, false);
  assert.equal(contract.verification.tests_required, true);
  assert.equal(contract.verification.falsifier_required, true);
  assert.deepEqual(contract.verification.commands, ['npm test', 'node --check gateway/src/seer.mjs']);
  for (const protectedPath of selfDevelopmentProtectedPaths()) {
    assert.equal(contract.scope.forbidden.includes(protectedPath), true);
  }
});

test('self-development refuses unsafe shell composition while allowing verified canonical self-modification', () => {
  assert.throws(() => buildSelfDevelopmentGraph({
    objective: 'Unsafe test',
    scope: { allowed: ['gateway/src/**'] },
    acceptance: ['must pass'],
    verification: { commands: ['npm test && rm -rf .'] },
  }), /UNSAFE_VERIFICATION_COMMAND/);

  const graph = buildSelfDevelopmentGraph({
    objective: 'Ordinary source change',
    scope: { allowed: ['agents/**'] },
    acceptance: ['tests pass'],
    verification: { commands: ['node --test tests/nova/coding-contract.test.mjs'] },
  });
  assert.equal(graph.nodes[0].contract.scope.forbidden.includes('agents/lib/coding-contract.mjs'), false);
  assert.equal(graph.nodes[0].contract.scope.forbidden.includes('gateway/src/seer.mjs'), false);
  assert.equal(graph.nodes[0].contract.scope.forbidden.includes('package.json'), false);

  assert.throws(() => buildSelfDevelopmentGraph({
    objective: 'Path escape',
    scope: { allowed: ['gateway/src/**'] },
    acceptance: ['must pass'],
    verification: { commands: ['node --check ../outside.mjs'] },
  }), /VERIFICATION_PATH_UNSAFE/);
});

test('self-development requires explicit scope and acceptance criteria', () => {
  assert.throws(() => buildSelfDevelopmentGraph({
    objective: 'No scope',
    acceptance: ['pass'],
  }), /SCOPE_REQUIRED/);

  assert.throws(() => buildSelfDevelopmentGraph({
    objective: 'No acceptance',
    scope: { allowed: ['src/**'] },
  }), /ACCEPTANCE_REQUIRED/);
});

test('stabilization requires falsification and independent verification without expanding release permission', () => {
  const graph = buildSelfDevelopmentGraph({
    mode: 'stabilize', objective: 'Repair repeated API failures',
    scope: { allowed: ['src/**'] }, acceptance: ['API failure reproduced and repaired'],
    execution: { allow_git_push: false },
    verification: { commands: ['npm test'], required_stages: ['api', 'browser'],
      falsifier_required: false, independent_verification: false },
  });
  const contract = graph.nodes[0].contract;
  assert.equal(graph.policy.mode, 'contract-bound-stabilization');
  assert.equal(contract.verification.independent_verification, true);
  assert.equal(contract.verification.falsifier_required, true);
  assert.deepEqual(contract.verification.required_stages, ['api', 'browser']);
  assert.equal(graph.policy.git_push, false);
  assert.equal(contract.execution.allow_git_push, false);
});

test('self-development rejects empty checks and invalid verification stages', () => {
  const base = { objective: 'Repair service', scope: { allowed: ['src/**'] }, acceptance: ['works'] };
  assert.throws(() => buildSelfDevelopmentGraph({ ...base, verification: { commands: [] } }), /VERIFICATION_COMMAND_REQUIRED/);
  assert.throws(() => buildSelfDevelopmentGraph({ ...base, verification: { required_stages: ['imagined'] } }), /VERIFICATION_STAGE_INVALID/);
  assert.throws(() => buildSelfDevelopmentGraph({ ...base, mode: 'unbounded' }), /MODE_UNSUPPORTED/);
});

test('service definitions survive self-development and completion still needs runtime evidence', async () => {
  const { contractVerificationStatus } = await import('../../agents/lib/coding-contract.mjs');
  const service = { id: 'api', entry: 'src/server.mjs', healthPath: '/health', identity: 'test-api' };
  const graph = buildSelfDevelopmentGraph({
    mode: 'stabilize', objective: 'Stabilize API', scope: { allowed: ['src/**'] },
    acceptance: ['API responds'], services: [service], verification: { required_stages: ['api', 'service'] },
  });
  const contract = graph.nodes[0].contract;
  assert.deepEqual(contract.services, [service]);
  const status = contractVerificationStatus(contract, [
    { type: 'repo-test', ok: true, verified: true, result: { kind: 'test' } },
    { type: 'repo-test', ok: true, verified: true, result: { kind: 'falsifier' } },
  ]);
  assert.equal(status.machineVerified, false);
  assert.ok(status.missing.includes('independent_verification'));
  assert.ok(status.missing.some(item => item.includes('api')));
  assert.ok(status.missing.some(item => item.includes('service')));
});

test('self-development keeps canonical contract restrictions and explicit commit requirements', () => {
  const base = { objective: 'Repair source', scope: { allowed: ['src/**'], forbidden: ['src/private/**'] }, acceptance: ['tests pass'] };
  const graph = buildSelfDevelopmentGraph({ ...base, execution: { allow_git_commit: true, require_git_commit: false } });
  assert.equal(graph.nodes[0].contract.execution.require_git_commit, false);
  assert.deepEqual(graph.policy.protected_paths, graph.nodes[0].contract.scope.forbidden);
  graph.policy.protected_paths.push('display-only');
  assert.equal(graph.nodes[0].contract.scope.forbidden.includes('display-only'), false);
  assert.throws(() => buildSelfDevelopmentGraph({ ...base, services: false }), /CODING_SERVICES_INVALID/);
});
