import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentOrganization } from '../../runtime/src/server/connected/agentOrganization.mjs';
import { AURA_SPECIALISTS, planAuraSpecialistProvision, provisionAuraSpecialists } from '../../runtime/src/lib/auraSpecialistBlueprints.mjs';

const setup = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-specialists-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, organization: new AgentOrganization(root) };
};
const wire = organization => ({
  readAgents: async () => organization.snapshot().agents,
  createAgent: async profile => organization.createAgent(profile),
});

test('exactly four explicit specialists report to Aura, with no credentials', () => {
  assert.deepEqual(AURA_SPECIALISTS.map(a => a.id), [
    'grokbot-analyst', 'senior-developer', 'reliability-debugger', 'user-advocate',
  ]);
  for (const spec of AURA_SPECIALISTS) {
    assert.equal(spec.reportsTo, 'aura');
    assert.ok(spec.task.length > 50 && spec.goal.length > 50);
    assert.ok(!/api[_ -]?key|password|secret\s*=/.test(JSON.stringify(spec)));
  }
});

test('operator creates real persisted agent records, folders and zero-permission mandates', async t => {
  const { root, organization } = setup(t);
  const result = await provisionAuraSpecialists(wire(organization));
  assert.equal(result.created.length, 4);
  assert.deepEqual(result.present, []);
  for (const spec of AURA_SPECIALISTS) {
    const agent = organization.agent(spec.id);
    assert.equal(agent.status, 'active');
    assert.equal(agent.reportsTo, 'aura');
    assert.equal(agent.title, spec.title);
    assert.equal(agent.task, spec.task);
    assert.equal(agent.goal, spec.goal);
    assert.deepEqual(agent.mandate.permissions, {});
    assert.equal(agent.mandate.budgetUsdPerDay, 0);
    assert.equal(agent.mandate.autonomy, 1);
    assert.equal(agent.model.kind, 'local');
    assert.equal(agent.model.model, '');
    assert.deepEqual(organization.decide(agent.id, 'files.read'), {
      allowed: false, reason: 'PERMISSION_NOT_GRANTED', at: agent.id, needsApproval: false,
    });
    for (const f of ['rules.md', 'skills', 'memory', 'mcp.json'])
      assert.ok(fs.existsSync(path.join(root, 'org', 'agents', spec.id, f)));
    const sop = path.join(root, 'org', 'agents', spec.id, 'procedures', 'operating-procedure.md');
    assert.ok(fs.existsSync(sop), 'role SOP must be materialized for ' + spec.id);
    assert.match(fs.readFileSync(sop, 'utf8'), /^# /);
    fs.writeFileSync(sop, 'Operator customized SOP');
  }
  const restart = new AgentOrganization(root);
  restart.ensureFolder('grokbot-analyst');
  assert.equal(fs.readFileSync(path.join(root, 'org', 'agents', 'grokbot-analyst', 'procedures', 'operating-procedure.md'), 'utf8'), 'Operator customized SOP');
  assert.equal(restart.snapshot().agents.length, 5);
  assert.equal(restart.snapshot().agents.filter(a => AURA_SPECIALISTS.some(b => b.id === a.id)).length, 4);
});

test('provisioning is idempotent and leaves existing profiles and grants untouched', async t => {
  const { organization } = setup(t);
  await provisionAuraSpecialists(wire(organization));
  organization.updateProfile('senior-developer', { task: 'Operator custom work' });
  const again = await provisionAuraSpecialists(wire(organization));
  assert.deepEqual(again.created, []);
  assert.equal(again.present.length, 4);
  assert.equal(organization.agent('senior-developer').task, 'Operator custom work');
  assert.equal(organization.snapshot().agents.length, 5);
});

test('partial failure can be retried without duplicates', async t => {
  const { organization } = setup(t);
  let attempted = 0;
  await assert.rejects(
    provisionAuraSpecialists({
      readAgents: async () => organization.snapshot().agents,
      createAgent: async profile => {
        if (++attempted === 3) throw new Error('SIMULATED_NETWORK_FAILURE');
        return organization.createAgent(profile);
      },
    }),
    /SIMULATED_NETWORK_FAILURE/,
  );
  assert.equal(organization.snapshot().agents.length, 3);
  const resumed = await provisionAuraSpecialists(wire(organization));
  assert.deepEqual(resumed.created, ['reliability-debugger', 'user-advocate']);
  assert.equal(organization.snapshot().agents.length, 5);
});

test('an existing ID with a different owner or name is not overwritten', async t => {
  const { organization } = setup(t);
  organization.createAgent({ id: 'grokbot-analyst', name: 'Unknown', reportsTo: 'aura' });
  assert.throws(() => planAuraSpecialistProvision(organization.snapshot().agents), /SPECIALIST_ID_CONFLICT/);
  await assert.rejects(provisionAuraSpecialists(wire(organization)), /SPECIALIST_ID_CONFLICT/);
  assert.equal(organization.snapshot().agents.length, 2);
});

test('the dashboard exposes an explicit operator-authenticated creation action', () => {
  const ui = fs.readFileSync(new URL('../../runtime/src/components/AuraOrganizationPanel.tsx', import.meta.url), 'utf8');
  assert.match(ui, /create-aura-specialists/);
  assert.match(ui, /provisionAuraSpecialists\(/);
  assert.match(ui, /window\.confirm\(t\.teamConfirm\)/);
  assert.match(ui, /x-jaco-operator-token/);
  assert.doesNotMatch(ui, /bypassPermissions/);
});
