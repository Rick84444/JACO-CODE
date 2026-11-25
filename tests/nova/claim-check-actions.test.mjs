// An answer that says a tool did its work needs a receipt of that tool that succeeded and verified. The rule used to match the
// answer's facts against ALL receipt text, and a refused type-text still carries the text it was asked to type, so the answer
// "type-text wrote the line, desktop-observe confirmed it" passed while the step had failed and the field was empty (2026-11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkClaims, checkClaimsByRules, actionToolIssues } from '../../agents/lib/claim-check.mjs';

const receipt = (turn, type, ok, verified, extra = {}) => ({ actionId: `m:turn:${turn}`, type, ok, verified, input: {}, result: {}, ...extra });
const Q4 = [
  receipt(1, 'desktop-windows', true, true),
  receipt(2, 'desktop-observe', true, true),
  receipt(3, 'screenshot', true, true),
  receipt(4, 'type-text', false, false, { input: { text: 'JACO datorövning Q4' }, result: { error: 'FRESH_BOUND_DESKTOP_OBSERVATION_REQUIRED' } }),
  receipt(5, 'desktop-observe', true, true),
];

test('a claim that a tool wrote something is contradicted when that tool only has failed receipts', async () => {
  const answer = "4) type-text skrev 'JACO datorövning Q4' i textfältet [#4]. 5) desktop-observe bekräftade att texten står i fältet [#5].";
  const rules = checkClaimsByRules(answer, Q4);
  assert.deepEqual(rules.unsupportedActions.map(a => a.tool), ['type-text']);
  assert.equal(rules.unsupportedActions[0].failed, 1);
  const result = await checkClaims(answer, Q4, { env: {} });
  assert.equal(result.ok, false);
  assert.match(result.contradicted[0].why, /type-text has no succeeded and verified receipt \(1 of 1 failed\)/);
});

test('the same claim passes when the tool succeeded and verified, and tools that really ran are not flagged', () => {
  const ok = [...Q4.slice(0, 3), receipt(4, 'type-text', true, true), receipt(5, 'desktop-observe', true, true)];
  assert.deepEqual(actionToolIssues('type-text skrev raden i fältet', ok), []);
  assert.deepEqual(actionToolIssues('desktop-observe bekräftade fältet', Q4), [], 'a read-only tool is not an action tool');
});

test('an honest report of a refusal or an error is not flagged', () => {
  assert.deepEqual(actionToolIssues('type-text nekades med FRESH_BOUND_DESKTOP_OBSERVATION_REQUIRED', Q4), []);
  assert.deepEqual(actionToolIssues('type-text failed, so nothing was written', Q4), []);
  assert.deepEqual(actionToolIssues('Kunde inte skriva med type-text', Q4), []);
});

test('a tool that never ran is flagged too, with underscore and hyphen spellings', () => {
  assert.deepEqual(actionToolIssues('I used repo_write to save the file', Q4).map(i => i.tool), ['repo-write']);
  assert.equal(actionToolIssues('I used repo_write to save the file', Q4)[0].receipts, 0);
  assert.deepEqual(actionToolIssues('Nothing about tools here', Q4), []);
});
