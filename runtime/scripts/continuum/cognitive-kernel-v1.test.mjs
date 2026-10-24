import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContinuumEventStore } from '../../src/server/continuum/eventStore.mjs';
import { EvidenceLedger } from '../../src/server/continuum/evidenceLedger.mjs';
import { KnowledgeStore } from '../../src/server/continuum/knowledgeStore.mjs';
import { HypothesisEngine } from '../../src/server/continuum/hypothesisEngine.mjs';
import { CapabilityCompiler } from '../../src/server/continuum/capabilityCompiler.mjs';
import { CognitiveCompressor } from '../../src/server/continuum/cognitiveCompressor.mjs';
import { SemanticRepositoryModel } from '../../src/server/continuum/semanticRepositoryModel.mjs';
import { RuntimeSelfModel } from '../../src/server/continuum/runtimeSelfModel.mjs';
import { OutcomeKnowledgeCompiler } from '../../src/server/continuum/outcomeKnowledgeCompiler.mjs';
import { CognitiveKernel } from '../../src/server/continuum/cognitiveKernel.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cognitive-kernel-v1-'));
const workspace=path.join(root,'workspace');
const state=path.join(root,'state');
fs.mkdirSync(path.join(workspace,'src'),{recursive:true});
fs.mkdirSync(path.join(workspace,'tests'),{recursive:true});
fs.writeFileSync(path.join(workspace,'src','gateway.mjs'),"import { verifyReceipt } from './verify.mjs';\nexport function publish(){ return verifyReceipt(); }\n");
fs.writeFileSync(path.join(workspace,'src','verify.mjs'),"export function verifyReceipt(){ return { evidence: true, verified: true }; }\n");
fs.writeFileSync(path.join(workspace,'tests','gateway.test.mjs'),"import { publish } from '../src/gateway.mjs';\nif (!publish().verified) throw new Error('not verified');\n");

try{
  const events=new ContinuumEventStore(path.join(state,'ledger'));
  const evidence=new EvidenceLedger(state,events);
  const knowledge=new KnowledgeStore(state,events,evidence);
  const hypotheses=new HypothesisEngine(state,events,evidence);
  const capabilities=new CapabilityCompiler(state,events,knowledge,evidence);

  const repository=new SemanticRepositoryModel({workspaceRoot:workspace,stateRoot:state,events,evidence});
  const snapshot=repository.scan();
  assert.equal(snapshot.status,'SCANNED');
  assert.equal(snapshot.summary.complete,true);
  assert.equal(snapshot.summary.fileCount,3);
  assert.ok(snapshot.summary.edgeCount>=2);
  assert.ok(snapshot.evidenceRef);
  assert.ok(repository.query('verify').some(file=>file.path==='src/verify.mjs'));
  assert.deepEqual(repository.dependencies('src/gateway.mjs').imports,['src/verify.mjs']);

  const preliminary=evidence.record({kind:'observation',claim:'early observation'});
  const terminal=evidence.record({kind:'test',claim:'experiment falsified candidate',verified:true,verificationMethod:'test'});
  const set=hypotheses.createSet({id:'set-1',missionId:'mission-1',problem:'choose implementation',criteria:[{name:'success',weight:1,direction:'max'}]});
  const candidate=hypotheses.addCandidate(set.id,{id:'candidate-a',label:'unsafe retry',proposal:{strategy:'retry without receipt'}});
  hypotheses.evaluate(set.id,candidate.id,{status:'EVALUATED',evidenceRefs:[preliminary.id],metrics:{success:0.4}});
  const falsified=hypotheses.evaluate(set.id,candidate.id,{status:'FALSIFIED',reason:'verified duplicate side effect',evidenceRefs:[terminal.id],metrics:{success:0}});
  assert.deepEqual(falsified.terminalEvidenceRefs,[terminal.id]);
  assert.ok(falsified.evidenceRefs.includes(preliminary.id));

  const outcomeCompiler=new OutcomeKnowledgeCompiler({events,evidence,knowledge,hypotheses});
  const compiled=outcomeCompiler.compileHypothesis({setId:set.id,candidateId:candidate.id});
  assert.equal(compiled.knowledge.verificationStatus,'VERIFIED');
  assert.equal(compiled.knowledge.kind,'falsified-hypothesis-outcome');
  assert.deepEqual(compiled.knowledge.evidenceRefs,[terminal.id]);
  assert.throws(()=>outcomeCompiler.compileOutcome({outcome:'UNKNOWN',claim:'ambiguous external side effect',contradictsKnowledgeIds:[compiled.knowledge.id]}),/UNKNOWN outcome cannot/);
  assert.throws(()=>outcomeCompiler.compileHypothesis({setId:set.id,candidateId:candidate.id,contradictsKnowledgeIds:['x'],supersedesKnowledgeIds:['x']}),/both CONTRADICTED and SUPERSEDED/);

  const trajectoryEvidence=[];
  for(let i=0;i<3;i++)trajectoryEvidence.push(evidence.record({id:`trajectory-proof-${i}`,kind:'test',claim:`trajectory ${i}`,verified:true,verificationMethod:'test'}));
  const action={type:'click',selector:{css:'#go'},postcondition:{type:'selector_exists',selector:'#done'}};
  capabilities.recordTrajectory({workflowKey:'repo-fix',actions:[action],verified:true,success:true,evidenceRefs:[trajectoryEvidence[0].id]});
  capabilities.recordTrajectory({workflowKey:'repo-fix',actions:[action],verified:true,success:true,evidenceRefs:[trajectoryEvidence[1].id]});
  capabilities.recordTrajectory({workflowKey:'repo-fix',actions:[action],verified:true,success:false,evidenceRefs:[trajectoryEvidence[2].id]});
  capabilities.recordTrajectory({workflowKey:'duplicate-proof',actions:[action],verified:true,success:true,evidenceRefs:[trajectoryEvidence[0].id]});
  capabilities.recordTrajectory({workflowKey:'duplicate-proof',actions:[action],verified:true,success:true,evidenceRefs:[trajectoryEvidence[0].id]});
  capabilities.recordTrajectory({workflowKey:'duplicate-proof',actions:[action],verified:true,success:true,evidenceRefs:[trajectoryEvidence[0].id]});
  const selfModel=new RuntimeSelfModel({events,capabilities,knowledge,providers:{list:()=>[{id:'local',type:'ollama',enabled:true}]},repository});
  const self=selfModel.snapshot();
  const repoFix=self.capabilities.find(item=>item.capability==='repo-fix');
  assert.equal(repoFix.verifiedAttempts,3);
  assert.equal(repoFix.distinctEvidenceCount,3);
  assert.equal(repoFix.independentEvidenceSetCount,3);
  assert.equal(repoFix.successRate,0.6667);
  assert.equal(repoFix.state,'UNRELIABLE');
  const duplicated=self.capabilities.find(item=>item.capability==='duplicate-proof');
  assert.equal(duplicated.independentEvidenceSetCount,1);
  assert.equal(duplicated.state,'INSUFFICIENT_INDEPENDENT_EVIDENCE');
  assert.equal(self.repository.status,'SCANNED');

  const sourceIds=[];
  for(let i=0;i<3;i++){
    const proof=evidence.record({id:`knowledge-proof-${i}`,kind:'test',claim:`verified retry lesson ${i}`,verified:true,verificationMethod:'test'});
    const item=knowledge.put({id:`lesson-${i}`,kind:'lesson',purpose:`Retry lesson ${i} requires verified receipt before replay`,confidence:0.9,evidenceRefs:[proof.id],usedIn:[`mission-${i}`],dependencies:['verified-receipt'],failureModes:['unsafe-replay'],verificationStatus:'VERIFIED'});
    sourceIds.push(item.id);
  }
  const duplicateSourceIds=[];
  for(let i=0;i<3;i++)duplicateSourceIds.push(knowledge.put({id:`duplicate-lesson-${i}`,kind:'lesson',purpose:`Duplicate proof lesson ${i}`,confidence:0.8,evidenceRefs:['knowledge-proof-0'],verificationStatus:'VERIFIED'}).id);
  const compressor=new CognitiveCompressor({events,knowledge,capabilities,evidence});
  assert.throws(()=>compressor.compressKnowledge({knowledgeIds:duplicateSourceIds,minimum:3}),/independent evidence sets/);
  const pattern=compressor.compressKnowledge({knowledgeIds:sourceIds,minimum:3});
  assert.equal(pattern.verificationStatus,'UNVERIFIED');
  assert.equal(pattern.reusable,false);
  assert.equal(pattern.implementation.summary.distinctEvidenceCount,3);
  assert.equal(pattern.implementation.summary.independentEvidenceSetCount,3);
  assert.throws(()=>compressor.validatePattern(pattern.id,{evidenceRefs:[pattern.evidenceRefs[0]]}),/independent/);
  const holdout=evidence.record({kind:'holdout-test',claim:'historical replay confirmed receipt-before-replay invariant',verified:true,verificationMethod:'historical_replay'});
  const validated=compressor.validatePattern(pattern.id,{evidenceRefs:[holdout.id]});
  assert.equal(validated.verificationStatus,'VERIFIED');
  assert.equal(validated.reusable,true);

  const promotedReceipt=outcomeCompiler.promoteVerifiedReceipt({
    missionId:'nova-mission-1',
    actionId:'action-1',
    taskType:'android-observe',
    receipt:{
      ok:true,
      verified:true,
      outcomeUnknown:false,
      before:{title:'Settings',targets:12},
      after:{title:'Settings',targets:12},
      result:{receipt:{action_id:'action-1',action_type:'observe_screen',success:true,verified:true,before_hash:'before-hash',after_hash:'after-hash',package_name:'com.android.settings'}},
    },
  });
  assert.equal(promotedReceipt.evidence.verified,false);
  assert.equal(promotedReceipt.evidence.kind,'nova-action-receipt');
  assert.equal(promotedReceipt.knowledge.verificationStatus,'UNVERIFIED');
  assert.equal(promotedReceipt.knowledge.kind,'tool-attested-observation');
  assert.equal(promotedReceipt.knowledge.reusable,false);
  assert.deepEqual(promotedReceipt.knowledge.evidenceRefs,[promotedReceipt.evidence.id]);
  const promotedReceiptAgain=outcomeCompiler.promoteVerifiedReceipt({
    missionId:'nova-mission-1',
    actionId:'action-1',
    taskType:'android-observe',
    receipt:{
      ok:true,
      verified:true,
      outcomeUnknown:false,
      before:{title:'Settings',targets:12},
      after:{title:'Settings',targets:12},
      result:{receipt:{action_id:'action-1',action_type:'observe_screen',success:true,verified:true,before_hash:'before-hash',after_hash:'after-hash',package_name:'com.android.settings'}},
    },
  });
  assert.equal(promotedReceiptAgain.idempotent,true);
  assert.equal(promotedReceiptAgain.knowledge.id,promotedReceipt.knowledge.id);
  assert.throws(()=>outcomeCompiler.promoteVerifiedReceipt({
    missionId:'nova-mission-1',actionId:'action-2',taskType:'android-tap',
    receipt:{ok:true,verified:false,outcomeUnknown:true},
  }),/RECEIPT_PROMOTION_REJECTED:NOT_VERIFIED_KNOWN_OUTCOME/);

  // A tool cannot fabricate independent confirmation of its own external effect.
  assert.throws(()=>outcomeCompiler.promoteVerifiedReceipt({
    missionId:'nova-mission-1',actionId:'action-forged',taskType:'mcp-write',
    receipt:{ok:true,verified:true,outcomeUnknown:false,effectEvidence:{level:'INDEPENDENTLY_VERIFIED',independent:true}},
  }),/RECEIPT_PROMOTION_REJECTED:INDEPENDENT_EFFECT_VERIFICATION_REQUIRED/);

  const promotedDecision=outcomeCompiler.promoteVerifiedDecision({
    claim:'Unknown external outcomes must be reconciled before replay',
    kind:'helix-architecture-decision',
    missionId:'mission-1',
    evidenceRefs:[terminal.id],
    dependencies:['verified-receipt','unknown-outcome-reconciliation'],
    reusable:true,
  });
  assert.equal(promotedDecision.knowledge.verificationStatus,'VERIFIED');
  assert.equal(promotedDecision.knowledge.reusable,true);
  assert.deepEqual(promotedDecision.knowledge.evidenceRefs,[terminal.id]);

  const kernel=new CognitiveKernel({repository,selfModel,outcomes:outcomeCompiler,compressor,knowledge});
  const kernelSnapshot=kernel.snapshot();
  assert.equal(kernelSnapshot.schema,'jaco.cognitive-kernel.v1');
  assert.equal(kernelSnapshot.invariants.selfModelIsDerived,true);
  assert.equal(kernelSnapshot.invariants.patternsRequireIndependentHoldout,true);

  const partial=repository.scan({maxFiles:2});
  assert.equal(partial.status,'PARTIAL');
  assert.equal(partial.summary.complete,false);
  assert.equal(partial.summary.hitFileLimit,true);
  assert.ok(selfModel.snapshot().unknowns.includes('semantic_repository_partial'));

  assert.equal(events.verify().valid,true);
  const persistedReceiptKnowledgeId=promotedReceipt.knowledge.id;
  const persistedDecisionKnowledgeId=promotedDecision.knowledge.id;
  events.close();
  const reopenedEvents=new ContinuumEventStore(path.join(state,'ledger'));
  const reopenedEvidence=new EvidenceLedger(state,reopenedEvents);
  const reopenedKnowledge=new KnowledgeStore(state,reopenedEvents,reopenedEvidence);
  // A persisted tool-attested receipt remains UNVERIFIED without independent effect evidence.
  assert.equal(reopenedKnowledge.get(persistedReceiptKnowledgeId).verificationStatus,'UNVERIFIED');
  assert.equal(reopenedKnowledge.get(persistedReceiptKnowledgeId).reusable,false);
  assert.equal(reopenedKnowledge.get(persistedDecisionKnowledgeId).verificationStatus,'VERIFIED');
  assert.equal(reopenedEvents.verify().valid,true);
  reopenedEvents.close();

  console.log('COGNITIVE_KERNEL_V1: PASS (semantic repository, runtime self-model, outcome knowledge, durable Living Core promotion, evidence-set independence, holdout-gated compression)');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
