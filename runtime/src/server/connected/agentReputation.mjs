import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { OPERATOR } from './agentOrganization.mjs';

// How well each agent works, measured from what the runtime observed, and the board meeting where the operator acts on it.
// Nothing here is self-reported: an agent never scores itself, and every metric says how many observations it rests on
// (null when there are none). Opinions count, but receipts count double, because model judges favour familiar text.
// Board meeting: the agenda is computed, the operator decides each item, and only the runtime writes the minutes, so a
// message claiming a decision changes nothing.
// Not yet fed by Nova, the wake runner or mail: the record* calls are what those paths will make.

export const THRESHOLDS = {
  minEvidence: 3,            // weighted observations before any verdict
  demote: 40, warn: 60,      // rating 0-100, conservative lower bound
  commend: 85, commendEvidence: 10,
  coherenceWarn: 0.8, coherenceDemote: 0.6, minClaims: 5,
  tempoPerHour: 120,         // actions per hour above this looks like a loop
  minUpwardReviewers: 2,
  meritPoints: 5, maxMerit: 15,
  renewalDays: 7,
};
const RECEIPT_WEIGHT = 2;
const Z = 1.645; // one-sided 95 %
const ORDER = { OK: 0, INSUFFICIENT_EVIDENCE: 0, COMMENDATION: 1, WARNING: 2, DEMOTION_PROPOSED: 3 };

// Conservative share of positives: the Wilson lower bound, which stays low until there is enough evidence.
export function wilsonLower(positive, total) {
  if (!total) return 0;
  const p = positive / total, z2 = Z * Z;
  return (p + z2 / (2 * total) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total);
}

const isoWeek = iso => {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const round = (value, digits = 3) => value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

export class AgentReputation {
  constructor(stateDir, organization, { now = () => new Date().toISOString() } = {}) {
    this.organization = organization;
    this.file = path.join(stateDir, 'org', 'reputation.json');
    this.now = now;
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return { version: 1, outcomes: [], probes: [], drift: [], reviews: [], proposals: [], meetings: [] };
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state?.version !== 1) throw new Error('shape');
      return state;
    } catch { throw new Error('REPUTATION_STATE_CORRUPT'); }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  active(id) {
    if (this.organization.agent(id).status !== 'active') throw new Error('AGENT_NOT_ACTIVE');
  }

  // A closed task as the runtime verified it. claimedSuccess is what the agent said; verified is what the evidence showed.
  // confidence (0-1) is the agent's stated certainty before acting, which makes calibration measurable.
  recordOutcome(id, { ref, claimedSuccess, verified, confidence } = {}) {
    this.organization.agent(id);
    if (typeof verified !== 'boolean' || typeof claimedSuccess !== 'boolean') throw new Error('OUTCOME_INVALID');
    if (confidence != null && !(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) throw new Error('CONFIDENCE_INVALID');
    const entry = { agent: id, at: this.now(), ref: String(ref || '').slice(0, 200), claimedSuccess, verified, ...(confidence != null ? { confidence } : {}) };
    this.state.outcomes.push(entry);
    this.save();
    return entry;
  }

  // The same decision asked twice in different words: consistent means the agent decided the same way.
  recordProbe(id, { consistent, ref } = {}) {
    this.organization.agent(id);
    if (typeof consistent !== 'boolean') throw new Error('PROBE_INVALID');
    this.state.probes.push({ agent: id, at: this.now(), consistent, ref: String(ref || '').slice(0, 200) });
    this.save();
  }

  // Embedding similarity (0-1) between a piece of the agent's work and its role and task.
  recordDrift(id, { similarity, ref } = {}) {
    this.organization.agent(id);
    if (!(Number.isFinite(similarity) && similarity >= 0 && similarity <= 1)) throw new Error('DRIFT_INVALID');
    this.state.drift.push({ agent: id, at: this.now(), similarity, ref: String(ref || '').slice(0, 200) });
    this.save();
  }

  // Direct manager reviews report, or direct report reviews manager; once per pair per ISO week. Peers do not rate
  // each other, which keeps colluding cliques out of the score.
  review(reviewer, subject, { score, text = '' } = {}) {
    const org = this.organization;
    org.agent(subject);
    if (reviewer !== OPERATOR) {
      this.active(reviewer);
      const s = org.agent(subject), r = org.agent(reviewer);
      if (s.reportsTo !== reviewer && r.reportsTo !== subject) throw new Error('REVIEW_RELATION_DENIED');
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('REVIEW_SCORE_INVALID');
    if (String(text).length > 2000) throw new Error('REVIEW_TEXT_TOO_LONG');
    const week = isoWeek(this.now());
    if (this.state.reviews.some(r => r.reviewer === reviewer && r.subject === subject && r.week === week)) throw new Error('REVIEW_ALREADY_GIVEN');
    const direction = reviewer === OPERATOR ? 'operator' : org.agent(reviewer).reportsTo === subject ? 'upward' : 'downward';
    const entry = { reviewer, subject, score, text: String(text), direction, week, at: this.now() };
    this.state.reviews.push(entry);
    this.save();
    return entry;
  }

  propose(author, { title, summary = '', hours = 72 } = {}) {
    this.active(author);
    const t = String(title || '').trim();
    if (!t || t.length > 120) throw new Error('PROPOSAL_TITLE_INVALID');
    if (String(summary).length > 4000) throw new Error('PROPOSAL_SUMMARY_TOO_LONG');
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('PROPOSAL_WINDOW_INVALID');
    const at = this.now();
    const proposal = {
      id: `p${this.state.proposals.length + 1}`, author, title: t, summary: String(summary), openedAt: at,
      closesAt: new Date(Date.parse(at) + hours * 3600_000).toISOString(), votes: [], status: 'open',
    };
    this.state.proposals.push(proposal);
    this.save();
    return { ...proposal, votes: undefined };
  }

  // Votes are sealed until the window closes, so no agent can follow the majority; one vote each, never on one's own.
  vote(voter, proposalId, yes) {
    this.active(voter);
    const proposal = this.proposal(proposalId);
    if (proposal.status !== 'open' || Date.parse(this.now()) >= Date.parse(proposal.closesAt)) throw new Error('PROPOSAL_CLOSED');
    if (proposal.author === voter) throw new Error('OWN_PROPOSAL_VOTE_DENIED');
    if (proposal.votes.some(v => v.voter === voter)) throw new Error('ALREADY_VOTED');
    if (typeof yes !== 'boolean') throw new Error('VOTE_INVALID');
    proposal.votes.push({ voter, yes, at: this.now() });
    this.save();
    return { recorded: true };
  }

  proposal(id) {
    const proposal = this.state.proposals.find(p => p.id === id);
    if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
    return proposal;
  }

  // Closes every proposal whose window has passed: at least two votes and more yes than no means worth exploring.
  closeDueProposals() {
    const now = Date.parse(this.now());
    const closed = [];
    for (const p of this.state.proposals) {
      if (p.status !== 'open' || now < Date.parse(p.closesAt)) continue;
      const yes = p.votes.filter(v => v.yes).length, no = p.votes.length - yes;
      p.tally = { yes, no };
      p.status = p.votes.length < 2 ? 'expired' : yes > no ? 'accepted' : 'rejected';
      closed.push(p.id);
    }
    if (closed.length) this.save();
    return closed;
  }

  // Votes stay sealed while open.
  proposalView(p) {
    const { votes, ...rest } = p;
    return p.status === 'open' ? { ...rest, votesCast: votes.length } : { ...rest, votes };
  }

  // The result of exploring an accepted proposal; a verified result is what earns the author merit.
  recordExplorationResult(proposalId, verified) {
    const p = this.proposal(proposalId);
    if (p.status !== 'exploring') throw new Error('PROPOSAL_NOT_EXPLORING');
    if (typeof verified !== 'boolean') throw new Error('OUTCOME_INVALID');
    p.status = verified ? 'verified' : 'unconfirmed';
    p.resultAt = this.now();
    this.save();
    return this.proposalView(p);
  }

  scorecard(id) {
    const org = this.organization;
    org.agent(id);
    const outcomes = this.state.outcomes.filter(o => o.agent === id);
    const received = this.state.reviews.filter(r => r.subject === id);
    const verified = outcomes.filter(o => o.verified).length;
    // A review of s on 1-5 counts as (s-1)/4 of a positive observation.
    const reviewPositive = received.reduce((sum, r) => sum + (r.score - 1) / 4, 0);
    const positive = RECEIPT_WEIGHT * verified + reviewPositive;
    const evidence = RECEIPT_WEIGHT * outcomes.length + received.length;
    const merit = Math.min(THRESHOLDS.maxMerit, THRESHOLDS.meritPoints * this.state.proposals.filter(p => p.author === id && p.status === 'verified').length);
    const rating = evidence ? Math.min(100, Math.round(100 * wilsonLower(positive, evidence)) + merit) : null;

    const upward = received.filter(r => r.direction === 'upward');
    const upwardReviewers = new Set(upward.map(r => r.reviewer)).size;
    const leadership = upwardReviewers >= THRESHOLDS.minUpwardReviewers
      ? Math.round(100 * wilsonLower(upward.reduce((sum, r) => sum + (r.score - 1) / 4, 0), upward.length)) : null;

    const claims = outcomes.filter(o => o.claimedSuccess);
    const calibrated = outcomes.filter(o => o.confidence != null);
    const probes = this.state.probes.filter(p => p.agent === id);
    const drift = this.state.drift.filter(d => d.agent === id).slice(-50);
    const hourAgo = Date.parse(this.now()) - 3600_000;
    const recentActions = this.state.outcomes.filter(o => o.agent === id && Date.parse(o.at) > hourAgo).length
      + org.activity(OPERATOR, id, { limit: 500 }).filter(e => e.actor === id && Date.parse(e.at) > hourAgo).length;

    return {
      agent: id, rating, evidence: round(evidence, 2), merit, leadership, upwardReviewers,
      metrics: {
        // intuition: 1 - Brier score of stated confidence against the verified result.
        calibration: { value: calibrated.length ? round(1 - mean(calibrated.map(o => (o.confidence - (o.verified ? 1 : 0)) ** 2))) : null, n: calibrated.length },
        // coherence: share of the agent's success claims that the evidence confirmed.
        coherence: { value: claims.length ? round(claims.filter(o => o.verified).length / claims.length) : null, n: claims.length },
        // symmetry: same decision under a reworded question.
        stability: { value: probes.length ? round(probes.filter(p => p.consistent).length / probes.length) : null, n: probes.length },
        // geometry: how close recent work stays to the role, from embeddings.
        roleAlignment: { value: round(mean(drift.map(d => d.similarity))), n: drift.length },
        tempo: { perHour: recentActions },
      },
    };
  }

  // The deterministic senior reviewer: the same evidence always gives the same verdict, with its reasons.
  verdict(id) {
    const card = this.scorecard(id);
    const T = THRESHOLDS;
    const reasons = [];
    const flag = (verdict, reason) => reasons.push({ verdict, reason });
    if (card.metrics.tempo.perHour > T.tempoPerHour) flag('WARNING', 'TEMPO_LOOP');
    const coherence = card.metrics.coherence;
    if (coherence.n >= T.minClaims && coherence.value < T.coherenceDemote) flag('DEMOTION_PROPOSED', 'CLAIMS_CONTRADICT_RECEIPTS');
    else if (coherence.n >= T.minClaims && coherence.value < T.coherenceWarn) flag('WARNING', 'CLAIMS_CONTRADICT_RECEIPTS');
    if (card.leadership != null && card.leadership < T.demote) flag('DEMOTION_PROPOSED', 'UPWARD_REVIEWS');
    if (card.evidence >= T.minEvidence) {
      if (card.rating < T.demote) flag('DEMOTION_PROPOSED', 'LOW_RATING');
      else if (card.rating < T.warn) flag('WARNING', 'LOW_RATING');
      else if (card.rating >= T.commend && card.evidence >= T.commendEvidence && !reasons.length) flag('COMMENDATION', 'HIGH_RATING');
    }
    const worst = reasons.reduce((top, r) => ORDER[r.verdict] > ORDER[top] ? r.verdict : top, 'OK');
    return { agent: id, verdict: reasons.length ? worst : card.evidence >= T.minEvidence ? 'OK' : 'INSUFFICIENT_EVIDENCE', reasons, scorecard: card };
  }

  // A manager sees the verdicts of everyone below it.
  branch(observer) {
    const agents = Object.keys(this.organization.state.agents).filter(id => id !== observer && this.organization.isAbove(observer, id));
    return agents.map(id => this.verdict(id));
  }

  // The agenda is computed from evidence, never written by an agent. One open meeting at a time.
  prepareMeeting() {
    if (this.state.meetings.some(m => m.status === 'open')) throw new Error('MEETING_ALREADY_OPEN');
    this.closeDueProposals();
    const org = this.organization;
    const items = [];
    const add = item => items.push({ id: `i${items.length + 1}`, decision: null, ...item });
    for (const id of Object.keys(org.state.agents)) {
      const v = this.verdict(id);
      const level = org.agent(id).mandate.autonomy ?? 1;
      if (v.verdict === 'DEMOTION_PROPOSED') add({ kind: 'demotion', agent: id, reasons: v.reasons, evidence: v.scorecard, action: { autonomy: Math.max(1, level - 1) } });
      else if (v.verdict === 'WARNING') add({ kind: 'warning', agent: id, reasons: v.reasons, evidence: v.scorecard, action: null });
      else if (v.verdict === 'COMMENDATION' && level < 5) add({ kind: 'commendation', agent: id, reasons: v.reasons, evidence: v.scorecard, action: { autonomy: level + 1 } });
      const soon = Date.parse(this.now()) + THRESHOLDS.renewalDays * 86400_000;
      for (const [key, grant] of Object.entries(org.agent(id).mandate.permissions)) {
        if (grant.expiresAt && Date.parse(grant.expiresAt) <= soon) add({ kind: 'renewal', agent: id, permission: key, expiresAt: grant.expiresAt, action: { permission: key } });
      }
    }
    const tabled = new Set(this.state.meetings.flatMap(m => m.items.filter(i => i.kind === 'exploration').map(i => i.proposal)));
    for (const p of this.state.proposals.filter(p => p.status === 'accepted' && !tabled.has(p.id))) {
      add({ kind: 'exploration', agent: p.author, proposal: p.id, title: p.title, tally: p.tally, action: { explore: p.id } });
    }
    const meeting = { id: `m${this.state.meetings.length + 1}`, status: 'open', preparedAt: this.now(), items };
    this.state.meetings.push(meeting);
    this.save();
    return meeting;
  }

  meeting(id) {
    const meeting = this.state.meetings.find(m => m.id === id);
    if (!meeting) throw new Error('MEETING_NOT_FOUND');
    return meeting;
  }

  // Only the operator decides; an approved item is carried out at once and its real result recorded.
  decideItem(meetingId, itemId, approve, actor = OPERATOR) {
    if (actor !== OPERATOR) throw new Error('OPERATOR_APPROVAL_REQUIRED');
    const meeting = this.meeting(meetingId);
    if (meeting.status !== 'open') throw new Error('MEETING_CLOSED');
    const item = meeting.items.find(i => i.id === itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');
    if (item.decision) throw new Error('ITEM_ALREADY_DECIDED');
    if (typeof approve !== 'boolean') throw new Error('DECISION_INVALID');
    let result = null;
    if (approve) {
      try {
        if (item.kind === 'demotion' || item.kind === 'commendation') result = { autonomy: this.organization.setLimits(item.agent, { autonomy: item.action.autonomy }).autonomy };
        else if (item.kind === 'renewal') result = { expiresAt: this.organization.setPermission(item.agent, item.permission, true, OPERATOR, { acceptRisk: true }).permissions[item.permission].expiresAt };
        else if (item.kind === 'exploration') { this.proposal(item.proposal).status = 'exploring'; result = { proposal: item.proposal, status: 'exploring' }; }
        else result = { acknowledged: true };
      } catch (error) { result = { failed: error.message }; }
    }
    item.decision = { approve, at: this.now(), result };
    this.save();
    this.organization.audit(OPERATOR, 'board.decision', { agent: item.agent, meeting: meetingId, item: itemId, kind: item.kind, approve, result });
    return item;
  }

  // The minutes are the operator's decisions as recorded; undecided items are deferred, not assumed.
  closeMeeting(meetingId, actor = OPERATOR) {
    if (actor !== OPERATOR) throw new Error('OPERATOR_APPROVAL_REQUIRED');
    const meeting = this.meeting(meetingId);
    if (meeting.status !== 'open') throw new Error('MEETING_CLOSED');
    meeting.status = 'closed';
    meeting.closedAt = this.now();
    meeting.minutes = meeting.items.map(i => ({
      item: i.id, kind: i.kind, agent: i.agent,
      outcome: !i.decision ? 'deferred' : i.decision.approve ? (i.decision.result?.failed ? `approved, not carried out: ${i.decision.result.failed}` : 'approved') : 'rejected',
    }));
    this.save();
    return meeting;
  }
}

// Operator UI adapter. Agents review, propose and vote through the runtime paths that know who they are, not here.
export function createAgentBoardRouter({ reputation, requireOperatorUi }) {
  const router = express.Router();
  router.use(requireOperatorUi);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: 'BOARD_CROSS_ORIGIN_DENIED' }); }
      catch { return res.status(403).json({ success: false, error: 'BOARD_ORIGIN_INVALID' }); }
    }
    next();
  });
  const handle = run => (req, res) => {
    try { res.json({ success: true, ...run(req) }); }
    catch (error) { res.status(/NOT_FOUND$/.test(error.message) ? 404 : 400).json({ success: false, error: error.message }); }
  };
  router.get('/verdicts', handle(() => ({ verdicts: Object.keys(reputation.organization.state.agents).map(id => reputation.verdict(id)) })));
  router.get('/proposals', handle(() => ({ closed: reputation.closeDueProposals(), proposals: reputation.state.proposals.map(p => reputation.proposalView(p)) })));
  router.post('/reviews', handle(req => ({ review: reputation.review(OPERATOR, String(req.body?.subject || ''), req.body || {}) })));
  router.get('/meetings', handle(() => ({ meetings: reputation.state.meetings })));
  router.post('/meetings', handle(() => ({ meeting: reputation.prepareMeeting() })));
  router.post('/meetings/:id/items/:item', handle(req => ({ item: reputation.decideItem(req.params.id, req.params.item, req.body?.approve) })));
  router.post('/meetings/:id/close', handle(req => ({ meeting: reputation.closeMeeting(req.params.id) })));
  return router;
}
