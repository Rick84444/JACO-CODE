// Aura understands the difference herself: free inside the contract, stop only for hard limits or
// unbooked outward actions, and never ask about a temporary model wait. The same registers the runtime
// enforces are the ones she is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSystemFor, AUTONOMY_RULE } from '../../agents/hands-off-agent.mjs';
import { boundContract } from '../../agents/lib/context-packet.mjs';
import { PRE_APPROVABLE, HARD_LIMITS } from '../../agents/lib/operator-action-guard.mjs';

test('the autonomy policy is part of Aura\'s system text and names the real limits', () => {
  const system = agentSystemFor(['repo-read', 'repo-write'], 'win32', false, 'sv');
  assert.ok(system.includes(AUTONOMY_RULE));
  assert.ok(system.includes('Working inside a coding contract'));
  for (const id of Object.keys(PRE_APPROVABLE)) assert.ok(system.includes(id), `booked kind ${id} is named`);
  for (const limit of HARD_LIMITS) assert.ok(system.includes(limit), `hard limit "${limit}" is named`);
});

test('the policy tells her not to ask about temporary model waits', () => {
  assert.match(AUTONOMY_RULE, /temporary model or provider wait is not a question/);
});

test('her packet shows the contract\'s booked kinds', () => {
  const c = boundContract({ objective: 'Fix tests', preApproved: ['merge-or-release', 'publish-or-deploy'], scope: { allowed: ['src/**'] } });
  assert.deepEqual(c.preApproved, ['merge-or-release', 'publish-or-deploy']);
});

import { localServicesFact } from '../../agents/hands-off-agent.mjs';
test('Aura is given the resolved local service addresses as fact, so she does not search for them', () => {
  const fact = localServicesFact({});
  assert.match(fact, /runtime \(Core\) http:\/\/127\.0\.0\.1:\d+/);
  assert.match(fact, /do not search for them/);
  assert.match(agentSystemFor(['repo-read'], 'win32', false, 'sv'), /runtime \(Core\) http:\/\/127\.0\.0\.1:/);
});
