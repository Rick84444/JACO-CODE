// Live finding (2026-11-16): Aura's active missions failed every tick with CONTEXT_PACKET_BUDGET_EXCEEDED,
// so no action ever ran. A long mission contract was carried in full and never trimmed. A planner that
// cannot build its context must still get the objective, the allowed tasks and the authority limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPacket } from '../../agents/lib/context-packet.mjs';

const longText = (n, label) => `${label} `.repeat(Math.ceil(n / (label.length + 1))).slice(0, n);

function bigMission() {
  return {
    id: 'mission-long-1',
    goal: 'skapa agenten',
    allowedTasks: ['repo-read', 'repo-write', 'repo-test', 'web-fetch'],
    budget: { max_steps: 40, max_tool_calls: 60 },
    contract: {
      schema: 'jaco.coding-contract/v1',
      objective: longText(40_000, 'Mål och delmål'),
      acceptance: Array.from({ length: 60 }, (_, i) => `Kriterium ${i}: ${longText(600, 'krav')}`),
      scope: { allowed: Array.from({ length: 80 }, (_, i) => `dir${i}/**`), forbidden: ['.env'] },
      verification: { commands: ['npm test'], required_stages: [] },
      execution: { autonomous: true, allow_git_push: false },
    },
    receipts: [],
  };
}

test('a long mission contract still yields a bounded packet with objective, tasks and authority', () => {
  const packet = buildContextPacket({ mission: bigMission(), maxChars: 12_000 });
  const size = JSON.stringify(packet).length;
  assert.ok(size <= 12_000, `packet is ${size} chars`);
  assert.ok(packet.objective.length > 0, 'objective is kept');
  assert.deepEqual(packet.authority.allowedTasks, ['repo-read', 'repo-write', 'repo-test', 'web-fetch']);
  assert.equal(packet.authority.contract.execution.allow_git_push, false, 'no contract permission is widened by trimming');
  assert.equal(packet.authority.contract.verification.commands[0], 'npm test', 'verification commands stay');
});

test('a normal mission is not changed by the bound', () => {
  const small = { id: 'm1', goal: 'läs README', allowedTasks: ['repo-read'], receipts: [] };
  const packet = buildContextPacket({ mission: small, maxChars: 12_000 });
  assert.equal(packet.objective, 'läs README');
});
