import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineApprovalPresentation } from '../../runtime/src/lib/inlineApproval.mjs';

const base = {
  id:'approval-001', kind:'MISSION', source:'durable-nova', title:'Open Notepad',
  reason:'An operator decision is required', risk:'MEDIUM',
  actions:['resume','cancel'],details:{missionId:'mission-1',phase:'BLOCKED',latestReceipt:null},
};

test('a normal pending mission becomes a brief resume/decline question',()=>{
  const p=inlineApprovalPresentation(base);
  assert.deepEqual(p.positive,['resume']);
  assert.deepEqual(p.negative,['cancel']);
  assert.equal(p.missingMission,false);
  assert.equal(p.requiresReview,false);
  assert.equal(p.question,'Fortsätta uppdraget?');
  assert.equal(p.summary,'Open Notepad');
});

test('payment and critical decisions require deliberate extra review, not a one-tap shortcut',()=>{
  assert.equal(inlineApprovalPresentation({...base,risk:'HIGH'}).requiresReview,true);
  assert.equal(inlineApprovalPresentation({...base,risk:'CRITICAL'}).requiresReview,true);
  assert.equal(inlineApprovalPresentation({...base,kind:'PAYMENT',risk:'LOW'}).requiresReview,true);
  assert.equal(inlineApprovalPresentation({...base,details:{outcomeUnknown:true}}).requiresReview,true);
  assert.equal(inlineApprovalPresentation({...base,risk:'LOW',kind:'ACTION'}).requiresReview,false);
});

test('stale Nova mission failure cannot be presented as a valid positive confirmation',()=>{
  for(const entry of [
    {...base,details:{error:'NOVA_MISSION_NOT_FOUND'}},
    {...base,details:{code:'NOVA_MISSION_NOT_FOUND'}},
    {...base,details:{latestReceipt:{error:'NOVA_MISSION_NOT_FOUND'}}},
  ])assert.equal(inlineApprovalPresentation(entry).missingMission,true);
  assert.equal(inlineApprovalPresentation({
    ...base,title:'Fix NOVA_MISSION_NOT_FOUND when resuming missions',
    reason:'Investigate NOVA_MISSION_NOT_FOUND and prevent it returning',
    details:{missionId:'mission-1',phase:'BLOCKED',latestReceipt:null},
  }).missingMission,false,'operator goal text is not authoritative evidence of a missing executor mission');
});

test('long goal text is compacted for chat without losing original decision scope',()=>{
  const long='Investigate safe code generation '+ 'details '.repeat(180);
  const p=inlineApprovalPresentation({...base,title:long,reason:long});
  assert.ok(p.summary.length<=150);
  assert.ok(p.shortReason.length<=180);
  assert.equal(p.risk,'MEDIUM');
});

test('inline chat uses existing server approval endpoint and explicit per-click confirmation',()=>{
  const root=readFileSync(new URL('../../runtime/src/components/JacoAuraComputeIDE.tsx',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../../runtime/src/components/AuraChatPanel.tsx',import.meta.url),'utf8');
  const inline=readFileSync(new URL('../../runtime/src/components/InlineAuraApproval.tsx',import.meta.url),'utf8');
  assert.match(root,/buildOperatorConfirmation\(/);
  assert.match(root,/approvals\/\$\{encodeURIComponent\(approval\.id\)\}\/decision/);
  assert.match(root,/inlineAcknowledged === true \|\| approvalAcknowledged/);
  assert.match(root,/approvalPrompt=\{pendingDecision \? <InlineAuraApproval/);
  // The chat reads oldest-to-newest, so the pending decision sits under the newest message, above the wait indicator.
  assert.match(panel,/\{visibleFeed\.map\([\s\S]*?\{approvalPrompt\}[\s\S]*?\{busy&&<div className="cognitive-response-wait"/);
  assert.match(inline,/onDecision\(action, positive\)/);
  assert.match(inline,/view\.missingMission \? \[\]/);
  assert.match(inline,/view\.requiresReview && reviewing !== action/);
  assert.doesNotMatch(root,/const attention = pendingDecision \? <section/,'large pending approval outside chat must not double-render');
});
