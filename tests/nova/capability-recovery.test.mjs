import test from 'node:test';
import assert from 'node:assert/strict';
import { observeMissionCapabilities, capabilityDenialCorrection, CAPABILITY_EVIDENCE_SCHEMA } from '../../agents/lib/capability-recovery.mjs';

const fn = name => ({ type: 'function', function: { name } });
test('capability evidence separates mission grants, callable catalog and executed proof', () => {
  const observed = observeMissionCapabilities({ id: 'm1', allowedTasks: ['repo-read','repo-write','repo-edit','mcp-call'] },
    [fn('repo-read'),fn('repo-write'),fn('blocked'),fn('complete')]);
  assert.equal(observed.schema, CAPABILITY_EVIDENCE_SCHEMA);
  assert.deepEqual(observed.callable, ['repo-read','repo-write']);
  assert.deepEqual(observed.notExposed, ['repo-edit']);
  assert.equal(observed.executionVerified, false, 'an advertised function is NOT a successful action');
});

test('the native tool list overrides a false planner assertion about file writing', () => {
  const e = observeMissionCapabilities({ id:'m2',allowedTasks:['repo-write'] }, [fn('repo-write'),fn('blocked')]);
  for (const reason of [
    'I cannot create new directories or files because I lack the tool',
    'repo-write is not in mission.allowedTasks; I cannot write a file',
    'Jag kan inte skapa filer och saknar verktyg för att skriva',
  ]) {
    const correction = capabilityDenialCorrection(reason, e);
    assert.equal(correction.tool, 'repo-write');
    assert.match(correction.message, /runtime will validate scope and policy/);
    assert.match(correction.message, /verified receipt/);
  }
});

test('a genuine missing tool is never invented from mission metadata', () => {
  const e = observeMissionCapabilities({ id:'m3',allowedTasks:['repo-write','repo-read'] }, [fn('repo-read')]);
  assert.equal(capabilityDenialCorrection('I cannot create a file: no repo-write tool', e), null);
  assert.equal(capabilityDenialCorrection('no tool to create a file', { callable: [] }), null);
});

test('an actual runtime permission refusal is not reinterpreted as a hallucination', () => {
  const e = observeMissionCapabilities({ id:'m4',allowedTasks:['repo-write'] }, [fn('repo-write')]);
  assert.equal(capabilityDenialCorrection('CODING_SCOPE_DENIED: cannot write file outside project',e),null);
  assert.equal(capabilityDenialCorrection('TASK_TURNED_OFF_BY_OPERATOR: cannot write files',e),null);
  assert.equal(capabilityDenialCorrection('OPERATOR_APPROVAL_REQUIRED: cannot create file',e),null);
  assert.equal(capabilityDenialCorrection('I cannot access the payment page',e),null);
});
