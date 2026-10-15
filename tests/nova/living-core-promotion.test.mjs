import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactPromotionReceipt,
  ensureLivingCorePromotionState,
  enqueueVerifiedReceiptPromotion,
  flushLivingCorePromotions,
} from '../../agents/lib/living-core-promotion.mjs';

test('verified receipt is queued once with compact evidence only',()=>{
  const state={};
  const receipt={
    ok:true,verified:true,outcomeUnknown:false,
    before:{title:'Settings',targets:12},
    after:{title:'Wi-Fi',targets:9},
    result:{
      secretRawPayload:'must-not-be-copied',
      receipt:{action_id:'a1',action_type:'observe_screen',success:true,verified:true,before_hash:'b',after_hash:'a',package_name:'com.android.settings',rawTree:'large-private-tree'},
    },
  };
  const first=enqueueVerifiedReceiptPromotion(state,{receipt,task:{id:'a1',type:'android-observe'},mission:{id:'m1'}});
  assert.equal(first.queued,true);
  assert.equal(state.livingCore.promotionOutbox.length,1);
  assert.equal(state.livingCore.promotionOutbox[0].receipt.result.receipt.rawTree,undefined);
  assert.equal(state.livingCore.promotionOutbox[0].receipt.result.secretRawPayload,undefined);
  const second=enqueueVerifiedReceiptPromotion(state,{receipt,task:{id:'a1',type:'android-observe'},mission:{id:'m1'}});
  assert.equal(second.queued,false);
  assert.equal(second.reason,'DUPLICATE');
});

test('unverified or ambiguous receipts are never queued',()=>{
  const state={};
  assert.equal(enqueueVerifiedReceiptPromotion(state,{
    receipt:{ok:true,verified:false,outcomeUnknown:true},
    task:{id:'a1',type:'android-tap'},mission:{id:'m1'},
  }).queued,false);
  assert.equal(ensureLivingCorePromotionState(state).promotionOutbox.length,0);
});

test('promotion outbox survives sink failure and removes item only after success',async()=>{
  const state={};
  enqueueVerifiedReceiptPromotion(state,{
    receipt:{ok:true,verified:true,outcomeUnknown:false,result:{receipt:{action_id:'a1',action_type:'observe_screen',success:true,verified:true}}},
    task:{id:'a1',type:'android-observe'},mission:{id:'m1'},
  });
  let calls=0;
  const failed=await flushLivingCorePromotions(state,async()=>{
    calls++;
    throw new Error('CONTINUUM_TEMPORARILY_UNAVAILABLE');
  });
  assert.equal(failed.promoted,0);
  assert.equal(failed.pending,1);
  assert.equal(state.livingCore.promotionOutbox[0].attempts,1);
  assert.match(state.livingCore.promotionStats.lastError,/CONTINUUM_TEMPORARILY_UNAVAILABLE/);

  const succeeded=await flushLivingCorePromotions(state,async input=>{
    calls++;
    assert.equal(input.missionId,'m1');
    assert.equal(input.actionId,'a1');
    return {knowledge:{id:'receipt_outcome_1'},idempotent:false};
  });
  assert.equal(succeeded.promoted,1);
  assert.equal(succeeded.pending,0);
  assert.equal(state.livingCore.promotionStats.lastKnowledgeId,'receipt_outcome_1');
  assert.equal(calls,2);
});

test('compact receipt preserves verification hashes but not arbitrary result payload',()=>{
  const compact=compactPromotionReceipt({
    ok:true,verified:true,outcomeUnknown:false,
    result:{foo:'bar',receipt:{verified:true,before_hash:'x',after_hash:'y',text:'secret UI text'}},
  });
  assert.equal(compact.result.receipt.before_hash,'x');
  assert.equal(compact.result.receipt.after_hash,'y');
  assert.equal(compact.result.receipt.text,undefined);
  assert.equal(compact.result.foo,undefined);
});


test('a verified write is not automatically recorded as independently verified knowledge',()=>{
  const state={};
  const fake={ok:true,verified:true,outcomeUnknown:false,effectEvidence:{level:'INDEPENDENTLY_VERIFIED',independent:true}};
  for(const type of ['android-tap','mcp-write','mcp-call','repo-write','git-commit','browser-click','unknown-task']){
    const r=enqueueVerifiedReceiptPromotion(state,{receipt:fake,task:{id:'a1',type},mission:{id:'m1'}});
    assert.equal(r.queued,false,type);
    assert.equal(r.reason,'INDEPENDENT_EFFECT_VERIFICATION_REQUIRED',type);
    assert.equal(r.evidence.level,'TOOL_ATTESTED','caller evidence cannot upgrade the level');
    assert.equal(r.evidence.independent,false);
  }
  assert.equal(state.livingCore?.promotionOutbox?.length||0,0);
});

test('old queued writes are quarantined before sink delivery, without losing legitimate observations',async()=>{
  const state={};
  const stateCore=ensureLivingCorePromotionState(state);
  stateCore.promotionOutbox.push(
    {id:'m1:write',missionId:'m1',actionId:'write',taskType:'mcp-write',receipt:{ok:true,verified:true,outcomeUnknown:false,effectEvidence:{level:'INDEPENDENTLY_VERIFIED'}},attempts:0},
    {id:'m1:read',missionId:'m1',actionId:'read',taskType:'repo-read',receipt:{ok:true,verified:true,outcomeUnknown:false},attempts:0},
  );
  const calls=[];
  const summary=await flushLivingCorePromotions(state,async input=>{calls.push(input);return {knowledge:{id:'k1'}};});
  assert.equal(summary.rejected,1);
  assert.equal(summary.promoted,1);
  assert.equal(summary.pending,0);
  assert.deepEqual(calls.map(c=>c.taskType),['repo-read']);
  assert.equal(summary.results[0].reason,'INDEPENDENT_EFFECT_VERIFICATION_REQUIRED');
  assert.equal(state.livingCore.promotionStats.rejected,1);
});

test('compact observation preserves only runtime-derived provenance, never claimed independent evidence',()=>{
  const receipt={ok:true,verified:true,outcomeUnknown:false,effectEvidence:{level:'INDEPENDENTLY_VERIFIED',independent:true}};
  const compact=compactPromotionReceipt(receipt,'repo-read');
  assert.equal(compact.effectEvidence.level,'TOOL_ATTESTED');
  assert.equal(compact.effectEvidence.independent,false);
  assert.equal(compact.effectEvidence.scope,'OBSERVATION');
});
