import test from 'node:test';
import assert from 'node:assert/strict';
import { marketWatchService } from '../../runtime/src/server/agents/marketWatchService.ts';

test('market-watch never presents old speculative seeds as verified market intelligence', () => {
  const state=marketWatchService.getState();
  assert.equal(state.recentIntelligence.length,0);
  assert.equal(state.totalScansCompleted,0);
  assert.equal(state.autoInjectIntoReasoning,false);
  assert.match(marketWatchService.getMarketWatchReasoningContext(), /No independently verified market observations/);
});

test('turning on context display does not promote unverified market synthesis into planner facts', () => {
  marketWatchService.setAutoInject(true);
  try { assert.match(marketWatchService.getMarketWatchReasoningContext(),/do not treat generated insights as verified facts/); }
  finally { marketWatchService.setAutoInject(false); }
});

test('no web evidence fails the market scan without increasing observed intelligence', async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('network unavailable')};
  try {
    const before=marketWatchService.getState();
    const response=await marketWatchService.executeOpenClawScrape('target_cursor');
    assert.equal(response.success,false);
    assert.match(response.message,/PROTOTYPE/);
    const after=marketWatchService.getState();
    assert.equal(after.totalIntelligenceGathered,before.totalIntelligenceGathered);
    assert.equal(after.totalScansCompleted,before.totalScansCompleted);
    assert.match(marketWatchService.getMarketWatchReasoningContext(),/No independently verified/);
  } finally { globalThis.fetch=previous; }
});
