import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetIntent } from './budgetIntent';
import { suggestedLimits, type Live } from '../components/CostChip';

test('the operator asking Aura to change the limit is understood in Swedish and English', () => {
  assert.deepEqual(budgetIntent('Höj molnbudgeten till 15 dollar'), { field: null, amount: 15, relative: false });
  assert.deepEqual(budgetIntent('öka månadsgränsen med 10 USD'), { field: 'monthly', amount: 10, relative: true });
  assert.deepEqual(budgetIntent('raise the daily limit to $25.5'), { field: 'daily', amount: 25.5, relative: false });
  assert.equal(budgetIntent('hur mycket har vi använt av budgeten?'), null);
  assert.equal(budgetIntent('sätt upp en webbsida åt mig'), null);
});

const live = (spentDay: number, spentMonth: number) => ({ governor: { dailySpentUsd: spentDay, monthlySpentUsd: spentMonth, reservedUsd: 0 },
  policy: { dailyCloudUsd: 15, monthlyCloudUsd: 20, maxCloudUsdPerTask: 0.55, maxAutonomousCloudCallsPer15m: 225, cloudEnabled: true } }) as unknown as Live;

test('an unnamed limit means the one that stops Aura now; "by" adds to it', () => {
  assert.deepEqual(suggestedLimits(live(9, 20), { field: null, amount: 30, relative: false }), { day: 15, month: 30, field: 'monthly' });
  assert.deepEqual(suggestedLimits(live(15, 10), { field: null, amount: 5, relative: true }), { day: 20, month: 20, field: 'daily' });
  assert.deepEqual(suggestedLimits(live(1, 1), { field: 'daily', amount: 8, relative: false }), { day: 8, month: 20, field: 'daily' });
});

test('a limit that is not about money is left to Aura', () => {
  assert.equal(budgetIntent('sätt en gräns på 5 filer per steg'), null);
  assert.deepEqual(budgetIntent('höj gränsen till 30 dollar'), { field: null, amount: 30, relative: false });
});
