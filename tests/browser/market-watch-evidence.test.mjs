import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MarketWatchService } from '../../runtime/src/server/agents/marketWatchService.ts';

test('Market Watch starts with no fabricated observations and no injected planning directives',()=>{
  const service=new MarketWatchService();
  const snapshot=service.getState();
  assert.equal(snapshot.totalScansCompleted,0);
  assert.equal(snapshot.totalIntelligenceGathered,0);
  assert.equal(snapshot.autoInjectIntoReasoning,false);
  assert.equal(snapshot.trackedTargets.every(target=>target.discoveredSignalsCount===0),true);
  service.setAutoInject(true);
  const text=service.getMarketWatchReasoningContext();
  assert.match(text,/No independently verified market claims available/);
  assert.doesNotMatch(text,/ALWAYS split missions|99.2%|96% determinism|ASSIGN.*sub-agents/i);
});

test('an unreachable source cannot be turned into a successful synthetic intelligence record',async()=>{
  const service=new MarketWatchService();
  const fetch0=globalThis.fetch;
  try{
    globalThis.fetch=async()=>({ok:false});
    await assert.rejects(service.executeOpenClawScrape('target_cursor'),/MARKET_WATCH_SOURCE_UNAVAILABLE/);
    assert.equal(service.getState().totalIntelligenceGathered,0);
    assert.equal(service.getState().totalScansCompleted,0);
    assert.equal(service.getState().trackedTargets[0].status,'active');
  }finally{globalThis.fetch=fetch0;service.stopPeriodicScan();}
});

test('an observed market summary cannot be promoted with a mismatched or nonexistent signed claim reference',()=>{
  const service=new MarketWatchService();
  const source='https://example.test/verified-update';
  const claim='Feature X was introduced';
  const observed={
    id:'observed-1',timestamp:'2026-11-11T00:00:00.000Z',
    competitorName:'Example',featureDomain:'TEST_GATES',
    observedUpdate:claim,architecturalBreakdown:'A research hypothesis',
    compressedDigest:'unverified',tacticalCounterStrategy:'',
    impactOnUpcomingPlans:'',confidenceScore:0,
    sourceUrls:[source],sourceDigest:'source-sha256',verificationLevel:'OBSERVED',
    proofHash:'observation-hash',status:'active'
  };
  service.intelligenceItems.push(observed);
  service.setAutoInject(true);
  assert.doesNotMatch(service.getMarketWatchReasoningContext(),/Feature X/);
  assert.throws(()=>service.promoteEvidence('observed-1',['evidence-1']),/MARKET_EVIDENCE_VALIDATOR_REQUIRED/);
  const hash=createHash('sha256').update(claim).digest('hex');
  service.setEvidenceValidator(()=>[{verified:true,source,data:{sourceDigest:'other-source',claimHash:hash}}]);
  assert.throws(()=>service.promoteEvidence('observed-1',['evidence-1']),/MARKET_EVIDENCE_NOT_BOUND_TO_CLAIM/);
  service.setEvidenceValidator(()=>[{verified:true,source,data:{sourceDigest:'source-sha256',claimHash:hash}}]);
  const verified=service.promoteEvidence('observed-1',['evidence-1']);
  assert.equal(verified.verificationLevel,'VERIFIED');
  const ctx=service.getMarketWatchReasoningContext();
  assert.match(ctx,/Feature X was introduced/);
  assert.match(ctx,/SIGNED EVIDENCE/);
  assert.match(ctx,/evidence-1/);
  service.setEvidenceValidator(()=>{throw Error('EVIDENCE_INTEGRITY_INVALID')});
  assert.doesNotMatch(service.getMarketWatchReasoningContext(),/Feature X/,'revalidation fails closed');
});
