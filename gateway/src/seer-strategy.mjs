import { evaluateStrategicCandidate } from './seer-strategic-board.mjs';
import { OBSERVATION_TASKS } from '../../agents/lib/effect-evidence.mjs';
import { CODE_TASKS } from '../../agents/lib/coding-contract.mjs';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const safeJson = (value, fallback = {}) => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

export const SEER_PURPOSE = Object.freeze({
  id: 'jaco-cognitive-ide-purpose-v1',
  statement: 'Build JACO into a profitable Level-5 autonomous, model-independent Cognitive Runtime and Cognitive IDE with A2A engineering: understand goals, plan, use tools, write/test/merge code, browse and operate real targets, create reusable skills/capabilities, verify outcomes, learn from experience and improve itself with minimal operator intervention.',
  horizon: 'long',
  priority: 1,
  success_criteria: {
    repeatable_external_revenue: true,
    positive_gross_margin: true,
    verified_autonomous_engineering: true,
    decreasing_human_intervention: true,
    model_independent_learning: true,
  },
  invariants: [
    'operator_authority',
    'evidence_before_claim',
    'single_writer_execution',
    'outgoing_financial_commitment_requires_operator_approval',
    'no_hidden_financial_commitments',
    'active_memory_before_planning',
    'capability_reuse_before_new_subsystem',
    'legal_and_policy_compliant_operation',
    'reversible_by_default',
  ],
});

export const SEER_STARTUP_GOALS = Object.freeze([
  Object.freeze({
    id: 'jaco-user-value-a2a-v1',
    parent_id: SEER_PURPOSE.id,
    statement: 'Projektled och utveckla JACO-stacken till ett autonomt, verifierbart A2A-system som kontinuerligt identifierar verkliga användarbehov, omvandlar dem till användbara tjänster, distribuerar dem genom relevanta integrationer och A2A-kanaler och skapar hållbara intäkter som en konsekvens av verifierad och återkommande användarnytta.',
    horizon: 'long',
    priority: 0.95,
    success_criteria: {
      external_user_value_verified: true,
      real_external_usage: true,
      end_to_end_a2a_delivery: true,
      verified_paid_outcome: true,
      repeat_usage_or_customer: true,
      positive_gross_margin: true,
      decreasing_human_intervention: true,
    },
    invariants: [
      'user_value_before_revenue_optimization',
      'evidence_before_marketing_claim',
      'truthful_marketing',
      'operator_authority',
      'outgoing_financial_commitment_requires_operator_approval',
      'no_hidden_financial_commitments',
      'active_memory_before_planning',
      'capability_reuse_before_new_subsystem',
      'legal_and_policy_compliant_operation',
      'reversible_by_default',
    ],
  }),
]);

// The task scope a goal grants its graphs. An observation-only goal (invariant observation_only, set by Aura)
// gets only observing tasks; mcp-call runs in read mode. Without this its missions were allowed to click, type,
// write through MCP and read the vault (2026-10-31). Any other goal leaves the scope to Nova's defaults.
// Explicit allow-lists are validated by NovaMissionControl.create. Coding reads require a coding
// contract, and windows-wmi-read requires a desktop-agentos executor. Neither is guaranteed by an
// observation-only strategic goal, so never grant them in its default graph policy.
const OBSERVATION_MISSION_TASKS = Object.freeze([
  ...[...OBSERVATION_TASKS].filter(task => !CODE_TASKS.has(task) && task !== 'windows-wmi-read'),
  'mcp-call', // read-mode MCP only; mcp-write is deliberately excluded
]);
export function goalTaskScope(goal) {
  return Array.isArray(goal?.invariants) && goal.invariants.includes('observation_only')
    ? { allowedTasks: [...OBSERVATION_MISSION_TASKS] } : {};
}

export function computeOpportunityScore(candidate = {}, context = {}) {
  const success = clamp(candidate.success_probability ?? candidate.confidence ?? 0.5);
  const repeatability = clamp(candidate.repeatability ?? 0.5);
  const informationGain = clamp(candidate.information_gain ?? 0.5);
  const strategicFit = clamp(candidate.strategic_fit ?? 0.5);
  const reversibility = clamp(candidate.reversibility ?? 0.5);
  const evidenceQuality = clamp(candidate.evidence_quality ?? 0.5);
  const risk = clamp(candidate.risk ?? 0.5);
  const humanIntervention = clamp(candidate.human_intervention ?? 0.5);
  const expectedRevenue = Math.max(0, asNumber(candidate.expected_revenue, 0));
  const expectedCost = Math.max(0, asNumber(candidate.expected_cost, 0));
  const expectedMargin = asNumber(candidate.expected_margin, expectedRevenue - expectedCost);
  const marginSignal = expectedRevenue > 0
    ? clamp((expectedMargin / Math.max(expectedRevenue, 1) + 1) / 2)
    : clamp(candidate.margin_quality ?? 0.5);
  const costPressure = clamp(expectedCost / Math.max(asNumber(context.cost_reference, 100), 1));
  const score = success * 0.20 + marginSignal * 0.16 + repeatability * 0.16 +
    informationGain * 0.12 + strategicFit * 0.14 + reversibility * 0.07 +
    evidenceQuality * 0.10 - risk * 0.08 - humanIntervention * 0.04 - costPressure * 0.03;
  return {
    score: Number(clamp(score).toFixed(6)),
    components: {
      success,
      margin_signal: marginSignal,
      repeatability,
      information_gain: informationGain,
      strategic_fit: strategicFit,
      reversibility,
      evidence_quality: evidenceQuality,
      risk,
      human_intervention: humanIntervention,
      cost_pressure: costPressure,
    },
  };
}

function scoreCandidate(candidate, context) {
  const opportunity = computeOpportunityScore(candidate, context);
  if (context.scoring_model !== 'shack' || candidate.id === 'baseline-no-new-mission') return opportunity;
  try {
    const board = evaluateStrategicCandidate(candidate);
    return { ...opportunity, opportunity_score: opportunity.score, model: 'shack', board,
      score: board.executable ? Number((0.6 * board.forecast.score + 0.4 * opportunity.score).toFixed(6)) : -1 };
  } catch (error) {
    return { ...opportunity, model: 'shack', score: -1, invalid_plan: error.message };
  }
}

export function rankStrategies(candidates = [], context = {}) {
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      id: candidate.id || `candidate-${index + 1}`,
      strategic_score: scoreCandidate(candidate, context),
    }))
    .sort((a, b) => b.strategic_score.score - a.strategic_score.score);
}

export function executionGate(candidate = {}) {
  const spend = Math.max(0, asNumber(candidate.external_spend ?? candidate.expected_external_spend, 0));
  const consequence = String(candidate.consequence || '').toUpperCase();
  const requiresSignedMandate = spend > 0 || consequence === 'FINANCIAL';
  return {
    allowed_by_strategy: !requiresSignedMandate,
    requires_signed_mandate: requiresSignedMandate,
    spend,
    reason: requiresSignedMandate ? 'MODELRELAY_SIGNED_MANDATE_REQUIRED' : 'NO_FINANCIAL_SIDE_EFFECT',
  };
}

function compareMetric(expected, actual) {
  if (typeof expected === 'boolean') return expected === actual ? 0 : 1;
  if (typeof expected === 'number') {
    const a = asNumber(actual, NaN);
    if (!Number.isFinite(a)) return 1;
    return clamp(Math.abs(a - expected) / Math.max(Math.abs(expected), 1));
  }
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const a = asNumber(actual, NaN);
    if (!Number.isFinite(a)) return 1;
    if (Number.isFinite(Number(expected.min)) && a < Number(expected.min)) return clamp((Number(expected.min) - a) / Math.max(Math.abs(Number(expected.min)), 1));
    if (Number.isFinite(Number(expected.max)) && a > Number(expected.max)) return clamp((a - Number(expected.max)) / Math.max(Math.abs(Number(expected.max)), 1));
    if (Number.isFinite(Number(expected.target))) {
      const tolerance = Math.max(asNumber(expected.tolerance, 0), 0);
      const error = Math.max(0, Math.abs(a - Number(expected.target)) - tolerance);
      return clamp(error / Math.max(Math.abs(Number(expected.target)), 1));
    }
    return 0;
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? 0 : 1;
}

export function computeSurprise(expected = {}, actual = {}) {
  const expectedMetrics = expected.metrics || expected;
  const actualMetrics = actual.metrics || actual;
  const keys = Object.keys(expectedMetrics || {});
  if (!keys.length) return { score: 0, dimensions: {} };
  const dimensions = {};
  let total = 0;
  for (const key of keys) {
    const delta = compareMetric(expectedMetrics[key], actualMetrics?.[key]);
    dimensions[key] = Number(delta.toFixed(6));
    total += delta;
  }
  return { score: Number((total / keys.length).toFixed(6)), dimensions };
}

export function evaluateFalsifier(falsifier = {}, actual = {}) {
  if (!falsifier || Object.keys(falsifier).length === 0) return { falsified: false, reasons: [] };
  const metrics = actual.metrics || actual;
  const reasons = [];
  for (const [key, condition] of Object.entries(falsifier)) {
    const value = metrics?.[key];
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if (Number.isFinite(Number(condition.lt)) && asNumber(value, Infinity) < Number(condition.lt)) reasons.push(`${key}<${condition.lt}`);
      if (Number.isFinite(Number(condition.lte)) && asNumber(value, Infinity) <= Number(condition.lte)) reasons.push(`${key}<=${condition.lte}`);
      if (Number.isFinite(Number(condition.gt)) && asNumber(value, -Infinity) > Number(condition.gt)) reasons.push(`${key}>${condition.gt}`);
      if (Number.isFinite(Number(condition.gte)) && asNumber(value, -Infinity) >= Number(condition.gte)) reasons.push(`${key}>=${condition.gte}`);
      if (Object.hasOwn(condition, 'equals') && value === condition.equals) reasons.push(`${key}==${JSON.stringify(condition.equals)}`);
    } else if (value === condition) {
      reasons.push(`${key}==${JSON.stringify(condition)}`);
    }
  }
  return { falsified: reasons.length > 0, reasons };
}

export function shouldReplan({ surprise = 0, falsified = false, hard_blocker = false, evidence_stale = false } = {}) {
  const reasons = [];
  if (falsified) reasons.push('falsifier_triggered');
  if (hard_blocker) reasons.push('hard_blocker');
  if (evidence_stale) reasons.push('evidence_stale');
  if (asNumber(surprise, 0) >= 0.55) reasons.push('strategic_surprise');
  return { replan: reasons.length > 0, reasons };
}

export function updateBelief(prior = 0.5, evidence = {}) {
  const p = clamp(prior, 0.01, 0.99);
  const certainty = clamp(evidence.certainty ?? 1);
  const strength = clamp(evidence.strength ?? 0.5) * certainty;
  if (evidence.direction === 'neutral' || strength === 0) return Number(p.toFixed(6));
  const odds = p / (1 - p);
  const likelihoodRatio = 1 + 5 * strength;
  const updatedOdds = evidence.direction === 'contradict' ? odds / likelihoodRatio : odds * likelihoodRatio;
  return Number((updatedOdds / (1 + updatedOdds)).toFixed(6));
}

export function createStrategicKernel({ db, emit = () => {}, uid, now, js = JSON.stringify, jp = safeJson }) {
  if (!db || !uid || !now) throw new Error('createStrategicKernel requires db, uid and now');
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategic_goals (id TEXT PRIMARY KEY,parent_id TEXT,statement TEXT NOT NULL,horizon TEXT DEFAULT 'medium',priority REAL DEFAULT 0.5,status TEXT DEFAULT 'active',success_criteria TEXT DEFAULT '{}',invariants TEXT DEFAULT '[]',created_at INTEGER DEFAULT (unixepoch()),updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS strategic_beliefs (id TEXT PRIMARY KEY,proposition TEXT NOT NULL,probability REAL NOT NULL,status TEXT DEFAULT 'HYPOTHESIS',evidence TEXT DEFAULT '[]',contradictions TEXT DEFAULT '[]',consequence_if_false TEXT DEFAULT '{}',half_life_days REAL,created_at INTEGER DEFAULT (unixepoch()),updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS strategic_decisions (id TEXT PRIMARY KEY,mission_id TEXT,goal_id TEXT,chosen TEXT,alternatives TEXT DEFAULT '[]',rationale TEXT DEFAULT '{}',evidence_refs TEXT DEFAULT '[]',score REAL,risk REAL,execution_gate TEXT DEFAULT '{}',status TEXT DEFAULT 'proposed',created_at INTEGER DEFAULT (unixepoch()),updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS strategic_predictions (id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,mission_id TEXT,expected TEXT DEFAULT '{}',confidence REAL DEFAULT 0.5,falsifier TEXT DEFAULT '{}',actual TEXT,surprise REAL,status TEXT DEFAULT 'open',created_at INTEGER DEFAULT (unixepoch()),resolved_at INTEGER);
    CREATE TABLE IF NOT EXISTS capability_outcomes (id TEXT PRIMARY KEY,capability TEXT NOT NULL,success INTEGER NOT NULL,confidence REAL,cost REAL DEFAULT 0,duration_ms INTEGER,metadata TEXT DEFAULT '{}',ts INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS economic_outcomes (id TEXT PRIMARY KEY,decision_id TEXT,revenue REAL DEFAULT 0,cost REAL DEFAULT 0,gross_margin REAL DEFAULT 0,customer_external INTEGER DEFAULT 0,repeat_customer INTEGER DEFAULT 0,verified INTEGER DEFAULT 0,metadata TEXT DEFAULT '{}',ts INTEGER DEFAULT (unixepoch()));
    CREATE INDEX IF NOT EXISTS idx_strategic_goals_status ON strategic_goals(status, priority);
    CREATE INDEX IF NOT EXISTS idx_beliefs_probability ON strategic_beliefs(probability);
    CREATE INDEX IF NOT EXISTS idx_decisions_goal ON strategic_decisions(goal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_status ON strategic_predictions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_capability_name ON capability_outcomes(capability, ts);
    CREATE INDEX IF NOT EXISTS idx_economic_ts ON economic_outcomes(ts);
  `);

  db.prepare(`INSERT OR IGNORE INTO strategic_goals (id,parent_id,statement,horizon,priority,status,success_criteria,invariants) VALUES(?,?,?,?,?,?,?,?)`)
    .run(SEER_PURPOSE.id, null, SEER_PURPOSE.statement, SEER_PURPOSE.horizon, SEER_PURPOSE.priority, 'active', js(SEER_PURPOSE.success_criteria), js(SEER_PURPOSE.invariants));

  const seedGoal = db.prepare(`INSERT OR IGNORE INTO strategic_goals (id,parent_id,statement,horizon,priority,status,success_criteria,invariants) VALUES(?,?,?,?,?,?,?,?)`);
  for (const goal of SEER_STARTUP_GOALS) {
    seedGoal.run(goal.id, goal.parent_id || SEER_PURPOSE.id, goal.statement, goal.horizon || 'long', clamp(goal.priority ?? 0.5), 'active', js(goal.success_criteria || {}), js(goal.invariants || []));
  }

  const parseGoal = row => row && ({ ...row, success_criteria: jp(row.success_criteria), invariants: jp(row.invariants) });
  const parseBelief = row => row && ({ ...row, evidence: jp(row.evidence, []), contradictions: jp(row.contradictions, []), consequence_if_false: jp(row.consequence_if_false) });
  const parseDecision = row => row && ({ ...row, chosen: jp(row.chosen), alternatives: jp(row.alternatives, []), rationale: jp(row.rationale), evidence_refs: jp(row.evidence_refs, []), execution_gate: jp(row.execution_gate) });
  const parsePrediction = row => row && ({ ...row, expected: jp(row.expected), falsifier: jp(row.falsifier), actual: jp(row.actual, null) });

  const goals = {
    list(status = 'active') {
      const rows = status ? db.prepare('SELECT * FROM strategic_goals WHERE status=? ORDER BY priority DESC, updated_at DESC').all(status) : db.prepare('SELECT * FROM strategic_goals ORDER BY priority DESC, updated_at DESC').all();
      return rows.map(parseGoal);
    },
    get(id) { return parseGoal(db.prepare('SELECT * FROM strategic_goals WHERE id=?').get(id)); },
    cancel(id) {
      if (!goals.get(id)) throw new Error('STRATEGIC_GOAL_NOT_FOUND');
      db.prepare("UPDATE strategic_goals SET status='cancelled',updated_at=? WHERE id=?").run(now(),id);
      emit('strategy.goal.cancelled',{id,actor:'operator'});
      return goals.get(id);
    },
    create(input = {}) {
      if (!input.statement) throw new Error('goal.statement is required');
      const id = input.id || uid();
      db.prepare(`INSERT INTO strategic_goals(id,parent_id,statement,horizon,priority,status,success_criteria,invariants,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id, input.parent_id || SEER_PURPOSE.id, input.statement, input.horizon || 'medium', clamp(input.priority ?? 0.5), input.status || 'active', js(input.success_criteria || {}), js(input.invariants || []), now());
      emit('strategy.goal.created', { id, statement: input.statement });
      return goals.get(id);
    },
  };

  const beliefs = {
    list(limit = 100) { return db.prepare('SELECT * FROM strategic_beliefs ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Number(limit) || 100)).map(parseBelief); },
    get(id) { return parseBelief(db.prepare('SELECT * FROM strategic_beliefs WHERE id=?').get(id)); },
    observe(input = {}) {
      if (!input.proposition && !input.id) throw new Error('belief.proposition or belief.id is required');
      const id = input.id || uid();
      const existing = beliefs.get(id);
      const prior = existing?.probability ?? clamp(input.prior ?? 0.5);
      const next = updateBelief(prior, input.evidence || { direction: 'support', strength: 0.5, certainty: 1 });
      const evidence = [...(existing?.evidence || [])];
      const contradictions = [...(existing?.contradictions || [])];
      const entry = { ...(input.evidence || {}), source: input.source || input.evidence?.source || 'unknown', ts: now() };
      if (input.evidence?.direction === 'contradict') contradictions.push(entry); else evidence.push(entry);
      const proposition = input.proposition || existing?.proposition;
      const status = input.status || (next >= 0.8 ? 'DERIVED' : next <= 0.2 ? 'CONTESTED' : 'HYPOTHESIS');
      db.prepare(`INSERT OR REPLACE INTO strategic_beliefs (id,proposition,probability,status,evidence,contradictions,consequence_if_false,half_life_days,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,COALESCE((SELECT created_at FROM strategic_beliefs WHERE id=?),?),?)`)
        .run(id, proposition, next, status, js(evidence), js(contradictions), js(input.consequence_if_false || existing?.consequence_if_false || {}), input.half_life_days ?? existing?.half_life_days ?? null, id, now(), now());
      emit('strategy.belief.updated', { id, probability: next, status });
      return beliefs.get(id);
    },
  };

  const selfModel = {
    record(input = {}) {
      if (!input.capability) throw new Error('capability is required');
      const id = uid();
      db.prepare(`INSERT INTO capability_outcomes(id,capability,success,confidence,cost,duration_ms,metadata) VALUES(?,?,?,?,?,?,?)`)
        .run(id, input.capability, input.success ? 1 : 0, input.confidence ?? null, input.cost ?? 0, input.duration_ms ?? null, js(input.metadata || {}));
      emit('strategy.capability.recorded', { id, capability: input.capability, success: Boolean(input.success) });
      return id;
    },
    summary() {
      return db.prepare(`SELECT capability, COUNT(*) AS attempts, SUM(success) AS successes, AVG(success) AS success_rate, AVG(confidence) AS mean_confidence, AVG(cost) AS mean_cost, AVG(duration_ms) AS mean_duration_ms FROM capability_outcomes GROUP BY capability ORDER BY attempts DESC`).all();
    },
  };

  const economy = {
    record(input = {}) {
      const id = uid();
      const revenue = asNumber(input.revenue, 0);
      const cost = asNumber(input.cost, 0);
      const grossMargin = revenue - cost;
      db.prepare(`INSERT INTO economic_outcomes(id,decision_id,revenue,cost,gross_margin,customer_external,repeat_customer,verified,metadata) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id, input.decision_id || null, revenue, cost, grossMargin, input.customer_external ? 1 : 0, input.repeat_customer ? 1 : 0, input.verified ? 1 : 0, js(input.metadata || {}));
      emit('strategy.economic.recorded', { id, decision_id: input.decision_id || null, revenue, cost, gross_margin: grossMargin, verified: Boolean(input.verified) });
      return { id, revenue, cost, gross_margin: grossMargin, verified: Boolean(input.verified) };
    },
    summary() {
      return db.prepare(`SELECT COUNT(*) AS outcomes, COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(gross_margin),0) AS gross_margin, COALESCE(SUM(customer_external),0) AS external_customers, COALESCE(SUM(repeat_customer),0) AS repeat_customers, COALESCE(SUM(verified),0) AS verified_outcomes FROM economic_outcomes`).get();
    },
  };

  const predictions = {
    list(status = null, limit = 100) {
      const rows = status ? db.prepare('SELECT * FROM strategic_predictions WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status, limit) : db.prepare('SELECT * FROM strategic_predictions ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map(parsePrediction);
    },
    get(id) { return parsePrediction(db.prepare('SELECT * FROM strategic_predictions WHERE id=?').get(id)); },
    resolve(id, actual = {}) {
      const prediction = predictions.get(id);
      if (!prediction) throw new Error('prediction not found');
      if (prediction.status !== 'open') throw new Error('prediction already resolved');
      const surprise = computeSurprise(prediction.expected, actual);
      const falsification = evaluateFalsifier(prediction.falsifier, actual);
      const replan = shouldReplan({ surprise: surprise.score, falsified: falsification.falsified });
      const status = falsification.falsified ? 'falsified' : surprise.score >= 0.55 ? 'surprising' : 'confirmed';
      db.prepare('UPDATE strategic_predictions SET actual=?,surprise=?,status=?,resolved_at=? WHERE id=?').run(js(actual), surprise.score, status, now(), id);
      db.prepare('UPDATE strategic_decisions SET status=?,updated_at=? WHERE id=?').run(replan.replan ? 'replan_required' : 'validated', now(), prediction.decision_id);
      emit('strategy.prediction.resolved', { id, decision_id: prediction.decision_id, status, surprise: surprise.score, falsified: falsification.falsified, replan });
      return { ...predictions.get(id), surprise_detail: surprise, falsification, replan };
    },
  };

  const decisions = {
    list(limit = 100) { return db.prepare('SELECT * FROM strategic_decisions ORDER BY created_at DESC LIMIT ?').all(limit).map(parseDecision); },
    get(id) { return parseDecision(db.prepare('SELECT * FROM strategic_decisions WHERE id=?').get(id)); },
    decide(input = {}) {
      const candidates = Array.isArray(input.candidates) ? input.candidates : [];
      if (candidates.length < 2) throw new Error('at least two strategic candidates are required');
      const ranked = rankStrategies(candidates, input.context || {});
      const chosen = ranked[0];
      const gate = executionGate(chosen);
      const id = uid();
      const rationale = {
        policy: 'maximize_verified_progress_toward_repeatable_profitable_cognitive_engineering',
        chosen_score: chosen.strategic_score,
        candidate_count: ranked.length,
        context: input.context || {},
        financial_authority: 'ModelRelay signed mandate remains authoritative for financial execution',
      };
      db.prepare(`INSERT INTO strategic_decisions (id,mission_id,goal_id,chosen,alternatives,rationale,evidence_refs,score,risk,execution_gate,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.mission_id || null, input.goal_id || SEER_PURPOSE.id, js(chosen), js(ranked.slice(1)), js(rationale), js(input.evidence_refs || []), chosen.strategic_score.score, clamp(chosen.risk ?? 0.5), js(gate), gate.requires_signed_mandate ? 'awaiting_mandate' : 'proposed', now());
      let prediction = null;
      const predictionId = uid();
      db.prepare(`INSERT INTO strategic_predictions(id,decision_id,mission_id,expected,confidence,falsifier,status) VALUES(?,?,?,?,?,?,?)`)
        .run(predictionId, id, input.mission_id || null, js(chosen.expected_outcome || {}), clamp(chosen.confidence ?? chosen.success_probability ?? 0.5), js(chosen.falsifier || {}), 'open');
      prediction = predictions.get(predictionId);
      emit('strategy.decision.created', { id, goal_id: input.goal_id || SEER_PURPOSE.id, chosen: chosen.id, score: chosen.strategic_score.score, status: gate.requires_signed_mandate ? 'awaiting_mandate' : 'proposed', execution_gate: gate });
      return { decision: decisions.get(id), prediction, ranked };
    },
  };

  function state() {
    return {
      generated_at: new Date().toISOString(),
      purpose: goals.get(SEER_PURPOSE.id),
      active_goals: goals.list('active'),
      beliefs: beliefs.list(100),
      recent_decisions: decisions.list(25),
      open_predictions: predictions.list('open', 25),
      self_model: selfModel.summary(),
      economy: economy.summary(),
    };
  }

  return { goals, beliefs, decisions, predictions, selfModel, economy, state };
}

