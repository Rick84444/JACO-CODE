import test from 'node:test';
import assert from 'node:assert/strict';
import { humanChatEvents, humanCodeText, operatorWords } from './humanChat';

const event = (category: string, text: string, missionId: string | null = 'm1', outcome = 'observed') =>
  ({ id: text.slice(0, 20), at: '2026-11-08T08:00:00Z', type: 'X', category, title: 't', text, durable: true, seq: 1, missionId, missionGoal: null, actionId: null,
     evidence: { outcome, path: null, url: null, commit: null, exitCode: null, error: null } }) as any;

test('a budget code becomes a sentence that says what to do, in the chosen language', () => {
  assert.match(humanCodeText('PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT', 'sv')!, /månadens budgetgräns.*dollartecknet/);
  assert.match(humanCodeText('PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT', 'en')!, /this month's budget limit/);
  assert.match(humanCodeText('NOVA_KNOWN_FAILURE:spawnSync cmd.exe ETIMEDOUT', 'sv')!, /tog för lång tid/);
  assert.equal(humanCodeText('Jag läser filen README.md.', 'sv'), null);
});

test('the chat keeps people words; runtime bookkeeping goes to background and raw text to evidence', () => {
  const { conversation, background } = humanChatEvents([
    event('blocked', 'PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT', 'm1', 'failed'),
    event('observation', 'mission:mission-1794082416703-3e2639f8 -> resume (auto-resumed (level 5): within the contract)'),
    event('observation', 'Durable Mission Bus dispatcher started at 1200ms', null),
    event('action', 'Steg 7: Jag kör npm test för att se att testerna passerar.'),
    event('goal', 'det godkänner jag\n\nAUTONOMOUS REPAIR CONTEXT:\nThe previous attempt failed with NOVA_KNOWN_FAILURE.'),
  ], 'sv');
  assert.equal(background.length, 2);
  assert.equal(conversation.length, 3);
  assert.match(conversation[0].text, /^Jag har nått månadens budgetgräns/);
  assert.match(conversation[0].evidence.error, /MONTHLY_BUDGET_LIMIT/);
  assert.equal(conversation[2].text, 'det godkänner jag');
  assert.ok(conversation.every((e: any) => !/[A-Z]+_[A-Z]+/.test(e.text)));
});

test('the operator words of a mission leave out the internal repair context', () => {
  assert.equal(operatorWords('fix the site\n\nAUTONOMOUS REPAIR CONTEXT:\nx'), 'fix the site');
});

test('a failed command keeps its output under evidence, not in the chat', () => {
  const { conversation } = humanChatEvents([event('result', 'Step 15: The command failed: ✔ a selected planner cannot be READY (10.03ms) ✖ other', 'm1', 'failed')], 'en');
  assert.equal(conversation[0].text, 'Step 15: The command failed. The output is under Evidence, and I am looking at what went wrong.');
  assert.match(conversation[0].evidence.error, /10\.03ms/);
});
