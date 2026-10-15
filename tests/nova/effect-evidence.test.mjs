import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEffectEvidence, receiptPromotionEligibility, EFFECT_EVIDENCE_SCHEMA } from '../../agents/lib/effect-evidence.mjs';
import { checkedReceipt } from '../../agents/lib/mission-client.mjs';
import { OutcomeKnowledgeCompiler } from '../../runtime/src/server/continuum/outcomeKnowledgeCompiler.mjs';

const good = { ok: true, verified: true, outcomeUnknown: false };

test('durable receipt evidence is derived from execution, never from tool-provided provenance', () => {
  const receipt = checkedReceipt({ type: 'mcp-write', data: { server: 'files', tool: 'write_file' } }, {
    ok: true, verified: true,
    effectEvidence: { schema: EFFECT_EVIDENCE_SCHEMA, level: 'INDEPENDENTLY_VERIFIED', independent: true },
  });
  assert.equal(receipt.effectEvidence.level, 'TOOL_ATTESTED');
  assert.equal(receipt.effectEvidence.scope, 'POTENTIAL_MUTATION');
  assert.equal(receipt.effectEvidence.independent, false);
  assert.equal(receipt.verified, true, 'execution receipt remains operationally compatible');
});

test('classifier retains UNKNOWN as separate from rejection or acknowledgement', () => {
  assert.equal(classifyEffectEvidence('browser-click', { ok: false, outcomeUnknown: true }).level, 'UNKNOWN');
  assert.equal(classifyEffectEvidence('repo-read', { ok: false, verified: false }).level, 'REJECTED');
  assert.equal(classifyEffectEvidence('repo-read', { ok: true, verified: false }).level, 'TRANSPORT_ACK');
  assert.equal(classifyEffectEvidence('repo-read', good).level, 'TOOL_ATTESTED');
  assert.equal(classifyEffectEvidence('mcp-call', good).scope, 'POTENTIAL_MUTATION');
  assert.equal(classifyEffectEvidence('web-fetch', good).scope, 'OBSERVATION');
});

test('only explicit observation tasks permit low-trust historical promotion', () => {
  const types = ['mcp-write','mcp-call','repo-write','repo-edit','git-commit','android-tap','browser-click','android-begin','android-target','repo-test','new-task'];
  for (const type of types) {
    const verdict = receiptPromotionEligibility(type, { ...good, effectEvidence: { independent: true, level: 'INDEPENDENTLY_VERIFIED' } });
    assert.equal(verdict.allowed, false, type);
    assert.equal(verdict.reason, 'INDEPENDENT_EFFECT_VERIFICATION_REQUIRED', type);
    assert.equal(verdict.evidence.independent, false);
  }
  assert.equal(receiptPromotionEligibility('repo-read', good).allowed, true);
});

function sink() {
  const evidenceRecords = new Map(), knowledgeRecords = new Map(), events = [];
  return {
    evidenceRecords, knowledgeRecords, events,
    compiler: new OutcomeKnowledgeCompiler({
      evidence: {
        exists: id => evidenceRecords.has(id),
        get: id => evidenceRecords.get(id),
        record: row => { evidenceRecords.set(row.id, row); return row; },
      },
      knowledge: {
        get: id => { if (!knowledgeRecords.has(id)) throw new Error('not found'); return knowledgeRecords.get(id); },
        put: row => { knowledgeRecords.set(row.id, row); return row; },
      },
      events: { append: row => events.push(row) },
    }),
  };
}

test('canonical knowledge sink refuses direct forged postcondition claims and mutating tool receipts', () => {
  const s = sink();
  for (const taskType of ['mcp-write','repo-write','browser-click','android-tap','mcp-call']) {
    assert.throws(() => s.compiler.promoteVerifiedReceipt({
      missionId: 'm1', actionId: 'a1', taskType,
      receipt: { ...good, effectEvidence: { level: 'INDEPENDENTLY_VERIFIED', independent: true } },
    }), /RECEIPT_PROMOTION_REJECTED:INDEPENDENT_EFFECT_VERIFICATION_REQUIRED/, taskType);
  }
  assert.equal(s.evidenceRecords.size, 0);
  assert.equal(s.knowledgeRecords.size, 0);
  assert.equal(s.events.length, 0);
});

test('canonical sink stores observation as tool-attested historical record, not independently verified knowledge', () => {
  const s = sink();
  const input = { missionId: 'm1', actionId: 'a1', taskType: 'repo-read',
    receipt: { ...good, effectEvidence: { level: 'INDEPENDENTLY_VERIFIED', independent: true } } };
  const result = s.compiler.promoteVerifiedReceipt(input);
  assert.equal(result.idempotent, false);
  assert.equal(result.evidence.verified, false);
  assert.equal(result.evidence.verificationMethod, 'durable_nova_tool_attestation');
  assert.equal(result.evidence.data.receipt.effectEvidence.level, 'TOOL_ATTESTED');
  assert.equal(result.knowledge.verificationStatus, 'UNVERIFIED');
  assert.equal(result.knowledge.reusable, false);
  assert.equal(result.knowledge.kind, 'tool-attested-observation');
  assert.equal(s.events[0].type, 'knowledge.receipt_observation_recorded');

  const again = s.compiler.promoteVerifiedReceipt(input);
  assert.equal(again.idempotent, true);
  assert.equal(s.evidenceRecords.size, 1);
  assert.equal(s.knowledgeRecords.size, 1);
  assert.equal(s.events.length, 1);
});

test('canonical sink refuses unknown or unacknowledged outcomes regardless of claimed evidence', () => {
  const s = sink();
  for (const receipt of [
    { ok: false, verified: true, outcomeUnknown: true },
    { ok: true, verified: false, outcomeUnknown: false },
    { ok: true, verified: true, outcomeUnknown: true },
  ]) {
    assert.throws(() => s.compiler.promoteVerifiedReceipt({
      missionId: 'm1', actionId: 'a1', taskType: 'repo-read',
      receipt: { ...receipt, effectEvidence: { level: 'INDEPENDENTLY_VERIFIED' } },
    }), /RECEIPT_PROMOTION_REJECTED:NOT_VERIFIED_KNOWN_OUTCOME/);
  }
});
