import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { AgentOrganization } from '../../runtime/src/server/connected/agentOrganization.mjs';
import { AgentReputation, createAgentBoardRouter, wilsonLower } from '../../runtime/src/server/connected/agentReputation.mjs';
const express = createRequire(new URL('../../runtime/package.json', import.meta.url))('express');

function company(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-board-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { now: '2026-11-02T09:00:00.000Z' };
  const now = () => clock.now;
  const organization = new AgentOrganization(root, { now });
  organization.setLimits('aura', { autonomy: 3 });
  for (const name of ['Ekonomi', 'Marknad']) organization.createAgent({ name });
  return { root, clock, organization, reputation: new AgentReputation(root, organization, { now }) };
}
const outcomes = (reputation, id, list) => list.forEach(([claimedSuccess, verified, confidence], i) =>
  reputation.recordOutcome(id, { ref: `task-${i}`, claimedSuccess, verified, confidence }));

test('the Wilson lower bound stays cautious until there is evidence', () => {
  assert.equal(wilsonLower(0, 0), 0);
  assert.ok(wilsonLower(1, 1) < 0.5, 'one success is not proof');
  assert.ok(wilsonLower(90, 100) > 0.83 && wilsonLower(90, 100) < 0.9, '90 of 100 is about 0.84');
});

test('metrics come only from observations and say how many they rest on', t => {
  const { reputation } = company(t);
  const empty = reputation.scorecard('ekonomi');
  assert.equal(empty.rating, null);
  for (const metric of ['calibration', 'coherence', 'stability', 'roleAlignment']) assert.deepEqual(empty.metrics[metric], { value: null, n: 0 });

  outcomes(reputation, 'ekonomi', [[true, true, 0.9], [true, false, 0.9], [true, true, 0.8], [false, false, 0.2]]);
  reputation.recordProbe('ekonomi', { consistent: true });
  reputation.recordProbe('ekonomi', { consistent: false });
  reputation.recordDrift('ekonomi', { similarity: 0.8 });
  reputation.recordDrift('ekonomi', { similarity: 0.6 });
  const { metrics } = reputation.scorecard('ekonomi');
  // Brier: (0.01 + 0.81 + 0.04 + 0.04) / 4 = 0.225
  assert.deepEqual(metrics.calibration, { value: 0.775, n: 4 });
  assert.deepEqual(metrics.coherence, { value: 0.667, n: 3 });
  assert.deepEqual(metrics.stability, { value: 0.5, n: 2 });
  assert.deepEqual(metrics.roleAlignment, { value: 0.7, n: 2 });
  assert.equal(metrics.tempo.perHour, 4);
  assert.throws(() => reputation.recordOutcome('ekonomi', { claimedSuccess: true, verified: true, confidence: 2 }), /CONFIDENCE_INVALID/);
});

test('reviews run only along the reporting line, once a week, and low upward reviews propose a demotion', t => {
  const { clock, organization, reputation } = company(t);
  assert.throws(() => reputation.review('marknad', 'ekonomi', { score: 1 }), /REVIEW_RELATION_DENIED/, 'peers do not rate each other');
  reputation.review('ekonomi', 'aura', { score: 1, text: 'Ger otydliga uppgifter' });
  assert.throws(() => reputation.review('ekonomi', 'aura', { score: 2 }), /REVIEW_ALREADY_GIVEN/);
  assert.equal(reputation.scorecard('aura').leadership, null, 'one reviewer is not enough');
  reputation.review('marknad', 'aura', { score: 2 });
  assert.equal(reputation.state.reviews.at(-1).direction, 'upward');
  const v = reputation.verdict('aura');
  assert.equal(v.verdict, 'DEMOTION_PROPOSED');
  assert.ok(v.reasons.some(r => r.reason === 'UPWARD_REVIEWS'));

  clock.now = '2026-11-09T09:00:00.000Z';
  reputation.review('ekonomi', 'aura', { score: 5 });
  reputation.review('aura', 'ekonomi', { score: 4 });
  assert.equal(reputation.state.reviews.at(-1).direction, 'downward');
  organization.setStatus('marknad', 'pause');
  assert.throws(() => reputation.review('marknad', 'aura', { score: 5 }), /AGENT_NOT_ACTIVE/);
});

test('the senior reviewer is deterministic: same evidence, same verdict and reasons', t => {
  const { reputation } = company(t);
  assert.equal(reputation.verdict('ekonomi').verdict, 'INSUFFICIENT_EVIDENCE');
  // Claims success six times, the evidence confirms four: coherence 0.667 and a rating of 43 are both below the warning line.
  outcomes(reputation, 'ekonomi', [[true, true], [true, true], [true, false], [true, true], [true, false], [true, true]]);
  const first = reputation.verdict('ekonomi');
  assert.equal(first.verdict, 'WARNING');
  assert.deepEqual(first.reasons, [{ verdict: 'WARNING', reason: 'CLAIMS_CONTRADICT_RECEIPTS' }, { verdict: 'WARNING', reason: 'LOW_RATING' }]);
  assert.equal(first.scorecard.rating, 43);
  assert.deepEqual(reputation.verdict('ekonomi'), first);

  outcomes(reputation, 'marknad', [[true, false], [true, false], [true, false], [true, false], [true, false]]);
  const failing = reputation.verdict('marknad');
  assert.equal(failing.verdict, 'DEMOTION_PROPOSED');
  assert.deepEqual(failing.reasons.map(r => r.reason), ['CLAIMS_CONTRADICT_RECEIPTS', 'LOW_RATING']);

  outcomes(reputation, 'aura', Array.from({ length: 30 }, () => [true, true]));
  assert.equal(reputation.verdict('aura').verdict, 'COMMENDATION');
  assert.equal(reputation.branch('aura').length, 2, 'a manager sees its whole branch');
  assert.equal(reputation.branch('ekonomi').length, 0);
});

test('proposals: sealed votes, no voting on your own, merit only for a verified exploration', t => {
  const { clock, reputation } = company(t);
  const p = reputation.propose('ekonomi', { title: 'Automatisera kvittoinläsning', hours: 24 });
  assert.throws(() => reputation.vote('ekonomi', p.id, true), /OWN_PROPOSAL_VOTE_DENIED/);
  reputation.vote('aura', p.id, true);
  assert.throws(() => reputation.vote('aura', p.id, false), /ALREADY_VOTED/);
  reputation.vote('marknad', p.id, true);
  const sealed = reputation.proposalView(reputation.proposal(p.id));
  assert.equal(sealed.votes, undefined);
  assert.equal(sealed.votesCast, 2);

  clock.now = '2026-11-03T09:00:00.000Z';
  assert.throws(() => reputation.vote('aura', p.id, true), /PROPOSAL_CLOSED/);
  assert.deepEqual(reputation.closeDueProposals(), [p.id]);
  assert.equal(reputation.proposal(p.id).status, 'accepted');
  const lonely = reputation.propose('marknad', { title: 'Ny logga', hours: 1 });
  reputation.vote('aura', lonely.id, true);
  clock.now = '2026-11-03T11:00:00.000Z';
  reputation.closeDueProposals();
  assert.equal(reputation.proposal(lonely.id).status, 'expired', 'one vote is not a quorum');
  assert.equal(reputation.scorecard('ekonomi').merit, 0, 'being voted through earns nothing yet');
});

test('board meeting: computed agenda, only the operator decides, decisions are carried out and minuted', t => {
  const { clock, organization, reputation } = company(t);
  organization.setLimits('marknad', { autonomy: 2 });
  outcomes(reputation, 'marknad', [[true, false], [true, false], [true, false], [true, false], [true, false]]);
  const p = reputation.propose('ekonomi', { title: 'Automatisera kvittoinläsning', hours: 1 });
  reputation.vote('aura', p.id, true);
  reputation.vote('marknad', p.id, true);
  organization.setPermission('aura', 'browser', true, 'operator', { acceptRisk: true, days: 3 });
  clock.now = '2026-11-02T11:00:00.000Z';

  const meeting = reputation.prepareMeeting();
  assert.throws(() => reputation.prepareMeeting(), /MEETING_ALREADY_OPEN/);
  const kinds = meeting.items.map(i => `${i.kind}:${i.agent}`).sort();
  assert.deepEqual(kinds, ['demotion:marknad', 'exploration:ekonomi', 'renewal:aura']);
  const item = kind => meeting.items.find(i => i.kind === kind);

  assert.throws(() => reputation.decideItem(meeting.id, item('demotion').id, true, 'aura'), /OPERATOR_APPROVAL_REQUIRED/);
  assert.deepEqual(reputation.decideItem(meeting.id, item('demotion').id, true).decision.result, { autonomy: 1 });
  assert.equal(organization.agent('marknad').mandate.autonomy, 1);
  reputation.decideItem(meeting.id, item('exploration').id, true);
  assert.equal(reputation.proposal(p.id).status, 'exploring');
  assert.throws(() => reputation.decideItem(meeting.id, item('exploration').id, false), /ITEM_ALREADY_DECIDED/);

  const closed = reputation.closeMeeting(meeting.id);
  assert.deepEqual(closed.minutes.map(m => [m.kind, m.outcome]).sort(), [['demotion', 'approved'], ['exploration', 'approved'], ['renewal', 'deferred']]);
  assert.ok(organization.activity('operator', 'marknad').some(e => e.action === 'board.decision'));

  reputation.recordExplorationResult(p.id, true);
  assert.equal(reputation.scorecard('ekonomi').merit, 5);
  const next = reputation.prepareMeeting();
  assert.equal(next.items.some(i => i.kind === 'exploration'), false, 'a proposal is tabled once');
});

test('board routes are operator-only and same-origin', async t => {
  const { reputation } = company(t);
  const app = express();
  app.use(express.json());
  app.use('/board', createAgentBoardRouter({ reputation, requireOperatorUi: (_req, _res, next) => next() }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/board`;
  const call = (route, method = 'GET', body, headers = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
    .then(async r => ({ status: r.status, data: await r.json() }));
  assert.equal((await call('/meetings', 'POST', {}, { origin: 'https://evil.example' })).status, 403);
  const { data } = await call('/meetings', 'POST', {});
  assert.equal(data.meeting.status, 'open');
  assert.equal((await call('/meetings/m9/close', 'POST', {})).status, 404);
  assert.equal((await call('/verdicts')).data.verdicts.length, 3);
});
