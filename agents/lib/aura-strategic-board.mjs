export const AURA_STRATEGIC_BOARD_SCHEMA = 'jaco.aura-strategic-board/v1';

export const AURA_BOARD_WEIGHTS = Object.freeze({
  goalImpact: 0.24,
  blockerRemoval: 0.22,
  criticalPath: 0.16,
  verificationGain: 0.12,
  informationGain: 0.10,
  confidence: 0.07,
  reversibility: 0.04,
  parallelism: 0.03,
  risk: -0.01,
  effort: -0.01,
});

export const AURA_ROLLOUT_WEIGHTS = Object.freeze({
  goalValue: 0.30,
  verificationValue: 0.20,
  informationValue: 0.12,
  normalizedConfidence: 0.15,
  blockerCoverage: 0.08,
  reversibility: 0.06,
  parallelism: 0.04,
  risk: -0.03,
  effort: -0.02,
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const clean = value => String(value ?? '').trim();
const uniq = values => [...new Set((Array.isArray(values) ? values : []).map(String).map(v => v.trim()).filter(Boolean))];

function assertId(value, field) {
  const id = clean(value);
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw new Error(`AURA_BOARD_${field}_INVALID`);
  return id;
}

function normalizeStatus(value) {
  const status = String(value || 'PENDING').toUpperCase();
  if (!['PENDING','READY','RUNNING','VERIFIED','BLOCKED','FAILED','SUPERSEDED','CANCELLED'].includes(status)) {
    throw new Error(`AURA_BOARD_STATUS_INVALID:${status}`);
  }
  return status;
}

function normalizeStep(input = {}, index = 0) {
  const id = assertId(input.id || `step-${index + 1}`, 'STEP_ID');
  return Object.freeze({
    id,
    title: clean(input.title || id),
    status: normalizeStatus(input.status),
    dependencies: uniq(input.dependencies),
    obstacles: uniq(input.obstacles),
    unlocks: uniq(input.unlocks),
    goalImpact: clamp01(input.goalImpact),
    verificationGain: clamp01(input.verificationGain),
    informationGain: clamp01(input.informationGain),
    confidence: clamp01(input.confidence ?? 0.5),
    reversibility: clamp01(input.reversibility ?? 0.5),
    parallelism: clamp01(input.parallelism ?? 0.5),
    risk: clamp01(input.risk),
    effort: clamp01(input.effort ?? 0.5),
    evidenceRefs: uniq(input.evidenceRefs),
  });
}

function normalizeObstacle(input = {}, index = 0) {
  const id = assertId(input.id || `obstacle-${index + 1}`, 'OBSTACLE_ID');
  const state = String(input.state || 'ACTIVE').toUpperCase();
  if (!['ACTIVE','CLEARED','UNKNOWN'].includes(state)) throw new Error(`AURA_BOARD_OBSTACLE_STATE_INVALID:${state}`);
  return Object.freeze({
    id,
    title: clean(input.title || id),
    state,
    severity: clamp01(input.severity ?? 0.5),
    hard: input.hard !== false,
    blocks: uniq(input.blocks),
    clearBy: uniq(input.clearBy),
    evidenceRefs: uniq(input.evidenceRefs),
  });
}

function effectiveDependencyMap(steps, obstacles) {
  const map = new Map(steps.map(step => [step.id, new Set(step.dependencies)]));
  for (const obstacle of obstacles) {
    if (!obstacle.hard || obstacle.state === 'CLEARED') continue;
    for (const blocked of new Set([...obstacle.blocks, ...steps.filter(step => step.obstacles.includes(obstacle.id)).map(step => step.id)])) {
      const deps = map.get(blocked);
      if (!deps) continue;
      for (const clearStep of obstacle.clearBy) deps.add(clearStep);
    }
  }
  return map;
}

function assertBoardDag(steps, obstacles) {
  const deps = effectiveDependencyMap(steps, obstacles);
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error(`AURA_BOARD_CYCLE:${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of deps.get(id) || []) {
      if (dep === id) throw new Error(`AURA_BOARD_SELF_DEPENDENCY:${id}`);
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id);
}

export function createStrategicBoard({ goalId, missionId, steps = [], obstacles = [] } = {}) {
  const normalizedSteps = steps.map(normalizeStep);
  const normalizedObstacles = obstacles.map(normalizeObstacle);
  const stepIds = new Set(normalizedSteps.map(step => step.id));
  const obstacleIds = new Set(normalizedObstacles.map(obstacle => obstacle.id));

  if (stepIds.size !== normalizedSteps.length) throw new Error('AURA_BOARD_DUPLICATE_STEP_ID');
  if (obstacleIds.size !== normalizedObstacles.length) throw new Error('AURA_BOARD_DUPLICATE_OBSTACLE_ID');

  for (const step of normalizedSteps) {
    for (const dep of step.dependencies) if (!stepIds.has(dep)) throw new Error(`AURA_BOARD_UNKNOWN_DEPENDENCY:${step.id}:${dep}`);
    for (const obstacle of step.obstacles) if (!obstacleIds.has(obstacle)) throw new Error(`AURA_BOARD_UNKNOWN_OBSTACLE:${step.id}:${obstacle}`);
  }
  for (const obstacle of normalizedObstacles) {
    for (const blocked of obstacle.blocks) if (!stepIds.has(blocked)) throw new Error(`AURA_BOARD_UNKNOWN_BLOCKED_STEP:${obstacle.id}:${blocked}`);
    for (const clearStep of obstacle.clearBy) if (!stepIds.has(clearStep)) throw new Error(`AURA_BOARD_UNKNOWN_CLEAR_STEP:${obstacle.id}:${clearStep}`);
  }
  assertBoardDag(normalizedSteps, normalizedObstacles);

  return Object.freeze({
    schema: AURA_STRATEGIC_BOARD_SCHEMA,
    goalId: assertId(goalId, 'GOAL_ID'),
    missionId: assertId(missionId, 'MISSION_ID'),
    steps: normalizedSteps,
    obstacles: normalizedObstacles,
  });
}

function maps(board) {
  return {
    steps: new Map(board.steps.map(step => [step.id, step])),
    obstacles: new Map(board.obstacles.map(obstacle => [obstacle.id, obstacle])),
  };
}

function resolvedStep(step) {
  return ['VERIFIED','SUPERSEDED','CANCELLED'].includes(step.status);
}

export function unresolvedHardObstacles(board, stepId) {
  const { steps, obstacles } = maps(board);
  const step = steps.get(stepId);
  if (!step) throw new Error('AURA_BOARD_STEP_NOT_FOUND');

  const relevant = new Set(step.obstacles);
  for (const obstacle of board.obstacles) if (obstacle.blocks.includes(stepId)) relevant.add(obstacle.id);

  return [...relevant]
    .map(id => obstacles.get(id))
    .filter(obstacle => {
      if (!obstacle || !obstacle.hard || obstacle.state === 'CLEARED') return false;
      const clearedByVerifiedSteps = obstacle.clearBy.length > 0
        && obstacle.clearBy.every(id => steps.get(id)?.status === 'VERIFIED');
      return !clearedByVerifiedSteps;
    });
}

export function isStrategicStepExecutable(board, stepId) {
  const { steps } = maps(board);
  const step = steps.get(stepId);
  if (!step) throw new Error('AURA_BOARD_STEP_NOT_FOUND');
  if (!['PENDING','READY','BLOCKED'].includes(step.status)) return false;
  if (unresolvedHardObstacles(board, stepId).length) return false;
  return step.dependencies.every(dep => steps.get(dep)?.status === 'VERIFIED');
}

function downstreamCount(board, stepId) {
  const dependents = new Map(board.steps.map(step => [step.id, []]));
  for (const [id, deps] of effectiveDependencyMap(board.steps, board.obstacles)) for (const dep of deps) dependents.get(dep)?.push(id);

  const seen = new Set();
  const stack = [...(dependents.get(stepId) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(dependents.get(id) || []));
  }
  return seen.size;
}

function blockerRemovalScore(board, stepId) {
  const active = board.obstacles.filter(obstacle => obstacle.state !== 'CLEARED'
    && !(obstacle.clearBy.length && obstacle.clearBy.every(id => board.steps.find(step => step.id === id)?.status === 'VERIFIED')));
  if (!active.length) return 0;
  let weighted = 0;
  let max = 0;
  for (const obstacle of active) {
    const weight = obstacle.severity * Math.max(1, obstacle.blocks.length);
    max += weight;
    if (obstacle.clearBy.includes(stepId)) weighted += weight;
  }
  return max > 0 ? clamp01(weighted / max) : 0;
}

export function scoreBoardStep(board, stepId, weights = AURA_BOARD_WEIGHTS) {
  const { steps } = maps(board);
  const step = steps.get(stepId);
  if (!step) throw new Error('AURA_BOARD_STEP_NOT_FOUND');

  const unresolved = board.steps.filter(item => !resolvedStep(item)).length;
  const downstream = downstreamCount(board, stepId);
  const metrics = {
    goalImpact: step.goalImpact,
    blockerRemoval: blockerRemovalScore(board, stepId),
    criticalPath: unresolved > 1 ? clamp01(downstream / (unresolved - 1)) : 0,
    verificationGain: step.verificationGain,
    informationGain: step.informationGain,
    confidence: step.confidence,
    reversibility: step.reversibility,
    parallelism: step.parallelism,
    risk: step.risk,
    effort: step.effort,
  };
  const rawScore = Object.entries(weights).reduce((sum, [key, weight]) => sum + (metrics[key] || 0) * weight, 0);
  const executable = isStrategicStepExecutable(board, stepId);

  return Object.freeze({
    stepId,
    executable,
    blockedBy: unresolvedHardObstacles(board, stepId).map(obstacle => obstacle.id),
    downstream,
    metrics,
    score: Number((executable ? rawScore : rawScore * 0.05).toFixed(6)),
  });
}

export function rankStrategicMoves(board) {
  const ranked = board.steps
    .filter(step => !resolvedStep(step) && !['RUNNING','FAILED'].includes(step.status))
    .map(step => scoreBoardStep(board, step.id))
    .sort((a, b) =>
      Number(b.executable) - Number(a.executable)
      || b.score - a.score
      || b.metrics.blockerRemoval - a.metrics.blockerRemoval
      || b.metrics.criticalPath - a.metrics.criticalPath
      || a.stepId.localeCompare(b.stepId)
    );

  return Object.freeze(ranked);
}

export function nextStrategicMoves(board, { limit = 3 } = {}) {
  return rankStrategicMoves(board)
    .filter(move => move.executable)
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 3)));
}

export function simulateStrategicBoard(board, weights = AURA_ROLLOUT_WEIGHTS) {
  const stepMap = new Map(board.steps.map(step => [step.id, step]));
  const deps = effectiveDependencyMap(board.steps, board.obstacles);
  const dependents = new Map(board.steps.map(step => [step.id, []]));
  for (const [id, values] of deps) for (const dep of values) dependents.get(dep)?.push(id);

  const indegree = new Map([...deps].map(([id, values]) => [id, values.size]));
  const staticUtility = step => {
    const score = step.goalImpact * 0.35
      + step.verificationGain * 0.20
      + step.informationGain * 0.15
      + step.confidence * 0.12
      + step.reversibility * 0.08
      + step.parallelism * 0.05
      - step.risk * 0.03
      - step.effort * 0.02;
    return Number(score.toFixed(6));
  };

  const queue = board.steps.filter(step => indegree.get(step.id) === 0)
    .sort((a,b) => staticUtility(b) - staticUtility(a) || a.id.localeCompare(b.id));
  const order = [];
  while (queue.length) {
    const step = queue.shift();
    order.push(step.id);
    for (const child of dependents.get(step.id) || []) {
      const next = Number(indegree.get(child) || 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(stepMap.get(child));
        queue.sort((a,b) => staticUtility(b) - staticUtility(a) || a.id.localeCompare(b.id));
      }
    }
  }
  if (order.length !== board.steps.length) throw new Error('AURA_BOARD_CYCLE');

  const probability = new Map();
  // Independent confidence factors are a planning assumption, not measured probabilities.
  // Shared ancestors are counted once, and verified receipts replace estimates with facts.
  const factors = new Map();
  const unreachable = new Set();
  let expectedGoal = 0;
  let expectedVerification = 0;
  let expectedInformation = 0;
  let expectedRisk = 0;
  let expectedEffort = 0;
  let expectedReversibility = 0;
  let expectedParallelism = 0;
  let totalGoal = 0;
  let totalVerification = 0;
  let totalInformation = 0;
  let reachableWeight = 0;
  let logConfidence = 0;
  let confidenceCount = 0;

  for (const id of order) {
    const step = stepMap.get(id);
    if (['SUPERSEDED','CANCELLED'].includes(step.status)) { probability.set(id, 0); factors.set(id, new Set([id])); continue; }
    const prereqs = [...(deps.get(id) || [])];
    const ancestors = new Set(prereqs.flatMap(dep => [...(factors.get(dep) || [])]));
    const confidenceOf = key => {
      const item = stepMap.get(key);
      return unreachable.has(key) || ['FAILED','SUPERSEDED','CANCELLED'].includes(item.status) ? 0 : item.confidence;
    };
    const impossibleObstacle = unresolvedHardObstacles(board, id).some(obstacle => !obstacle.clearBy.length);
    const reach = step.status === 'VERIFIED' ? 1 : impossibleObstacle ? 0
      : [...ancestors].reduce((p, dep) => p * confidenceOf(dep), 1);
    if (step.status !== 'VERIFIED') ancestors.add(id);
    else ancestors.clear();
    factors.set(id, ancestors);
    const success = step.status === 'VERIFIED' ? 1 : clamp01(reach * confidenceOf(id));
    if (success === 0) unreachable.add(id);
    probability.set(id, success);
    expectedGoal += step.goalImpact * success;
    expectedVerification += step.verificationGain * success;
    expectedInformation += step.informationGain * reach;
    expectedRisk += step.status === 'VERIFIED' ? 0 : step.risk * reach;
    expectedEffort += step.status === 'VERIFIED' ? 0 : step.effort * reach;
    expectedReversibility += step.reversibility * reach;
    expectedParallelism += step.parallelism * reach;
    totalGoal += step.goalImpact;
    totalVerification += step.verificationGain;
    totalInformation += step.informationGain;
    reachableWeight += reach;
    logConfidence += Math.log(Math.max(1e-9, step.status === 'VERIFIED' ? 1 : success > 0 ? step.confidence : 0));
    confidenceCount++;
  }

  const terminalIds = order.filter(id => !['SUPERSEDED','CANCELLED'].includes(stepMap.get(id).status) && (dependents.get(id) || []).length === 0);
  const terminalFactors = new Set(terminalIds.flatMap(id => [...(factors.get(id) || [])]));
  const terminalProbability = terminalIds.length
    ? terminalIds.some(id => probability.get(id) === 0) ? 0
      : [...terminalFactors].reduce((p, id) => p * stepMap.get(id).confidence, 1)
    : 0;
  const normalizedConfidence = confidenceCount ? Math.exp(logConfidence / confidenceCount) : 0;
  const activeHard = board.obstacles.filter(obstacle => obstacle.hard && obstacle.state !== 'CLEARED');
  const blockerCoverage = activeHard.length
    ? activeHard.filter(obstacle => obstacle.clearBy.length > 0).length / activeHard.length
    : 1;

  const metrics = {
    goalValue: totalGoal > 0 ? clamp01(expectedGoal / totalGoal) : 0,
    verificationValue: totalVerification > 0 ? clamp01(expectedVerification / totalVerification) : 0,
    informationValue: totalInformation > 0 ? clamp01(expectedInformation / totalInformation) : 0,
    normalizedConfidence: clamp01(normalizedConfidence),
    blockerCoverage: clamp01(blockerCoverage),
    reversibility: reachableWeight > 0 ? clamp01(expectedReversibility / reachableWeight) : 0,
    parallelism: reachableWeight > 0 ? clamp01(expectedParallelism / reachableWeight) : 0,
    risk: reachableWeight > 0 ? clamp01(expectedRisk / reachableWeight) : 1,
    effort: reachableWeight > 0 ? clamp01(expectedEffort / reachableWeight) : 1,
  };
  const score = Object.entries(weights).reduce((sum,[key,weight]) => sum + Number(metrics[key] || 0) * weight, 0);

  return Object.freeze({
    interpretation: 'heuristic forecast; independence assumed; not execution evidence',
    order,
    terminalIds,
    terminalProbability: Number(terminalProbability.toFixed(6)),
    normalizedConfidence: Number(normalizedConfidence.toFixed(6)),
    stepSuccess: Object.fromEntries([...probability].map(([id,p]) => [id, Number(p.toFixed(6))])),
    metrics,
    score: Number(score.toFixed(6)),
  });
}

export function strategicBoardSnapshot(board) {
  const ranked = rankStrategicMoves(board);
  const activeObstacles = board.obstacles.filter(obstacle => obstacle.state !== 'CLEARED'
    && !(obstacle.clearBy.length && obstacle.clearBy.every(id => board.steps.find(step => step.id === id)?.status === 'VERIFIED')));
  const verified = board.steps.filter(step => step.status === 'VERIFIED').length;

  return Object.freeze({
    schema: AURA_STRATEGIC_BOARD_SCHEMA,
    goalId: board.goalId,
    missionId: board.missionId,
    progress: board.steps.length ? Number((verified / board.steps.length).toFixed(6)) : 1,
    activeObstacles: activeObstacles.map(obstacle => ({
      id: obstacle.id,
      severity: obstacle.severity,
      hard: obstacle.hard,
      blocks: obstacle.blocks,
      clearBy: obstacle.clearBy,
    })),
    recommendedMoves: ranked.slice(0, 5),
  });
}



// Tactical Gameboard projection for every durable mission, including Lite without
// a graph adapter. These are planning postures, NOT fabricated mission nodes or
// permission to invoke a tool. Shared scoring is a heuristic, never evidence.
export function adaptiveMissionStrategy(mission = {}) {
  const receipts = Array.isArray(mission.receipts) ? mission.receipts : [];
  const last = receipts.at(-1);
  const base = {
    schema: 'jaco.adaptive-mission-strategy/v1',
    source: 'DURABLE_MISSION_RECEIPTS',
    status: 'RECOMMENDATION_ONLY',
    receiptCount: receipts.length,
    steeringRevision: Number.isSafeInteger(mission.steering?.revision) ? mission.steering.revision : 0,
    latestOutcome: !last ? 'NONE' : last.outcomeUnknown === true ? 'UNKNOWN' :
      last.ok === false ? 'FAILED' : last.ok === true && last.verified === true ? 'VERIFIED' : 'UNVERIFIED',
  };
  let hold = null;
  if (mission.strategicStateObserved === false) hold = 'MISSION_STATE_UNOBSERVED';
  else if (mission.hasUncertainOutcome === true || last?.outcomeUnknown === true) hold = 'RECONCILE_UNKNOWN_OUTCOME';
  else if (mission.cancelRequested || mission.status !== 'ACTIVE') hold = 'MISSION_NOT_ACTIVE';
  else if (mission.paused) hold = 'OPERATOR_PAUSED';
  else if (mission.pendingOperatorAction || mission.spendApprovalPending || mission.replanRequest) hold = 'WAIT_FOR_EXISTING_GATE';
  if (hold) return { ...base, status: 'HOLD', reason: hold, moves: [], recommendedMove: null };
  const failed = base.latestOutcome === 'FAILED';
  const unverified = base.latestOutcome === 'UNVERIFIED';
  const verified = base.latestOutcome === 'VERIFIED';
  const repeated = failed && receipts.slice(-3).filter(r => r?.ok === false && r?.type === last.type).length >= 2;
  // Fixed heuristic priors; they are policy-independent and deliberately not
  // labeled measured probabilities. Do not infer success from a model response.
  const definitions = [
    { id:'inspect', title:'Inspect current prerequisites and evidence', goalImpact: failed ? .85 : unverified ? .7 : .5,
      informationGain: 1, verificationGain:.65, confidence:.65, reversibility:1, risk:0, effort:.25 },
    { id:'change-approach', title:'Choose a materially different permitted route', goalImpact: failed ? 1 : .25,
      informationGain:failed ? .9 : .35, verificationGain:.65, confidence:failed ? .55 : .3, reversibility:.8, risk:.2, effort:.5 },
    { id:'verify', title:'Check the actual acceptance evidence', goalImpact: verified || unverified ? 1 : .35,
      informationGain:.6, verificationGain:1, confidence:.7, reversibility:1, risk:0, effort:.3 },
    { id:'advance', title:'Advance the next unmet prerequisite', goalImpact: failed || unverified ? .15 : 1,
      informationGain:.45, verificationGain:.6, confidence:failed || unverified ? .2 : .65, reversibility:.7, risk:.15, effort:.5 },
  ];
  if (repeated) {
    definitions[0].goalImpact = .45;
    definitions[1].verificationGain = .95;
  }
  const board = createStrategicBoard({goalId:'tactical-goal',missionId:'tactical-mission',
    steps:definitions.map(step=>({...step,status:'READY'}))});
  const ranks = rankStrategicMoves(board);
  // All four postures are alternatives, not parallel actions. Explicitly choose
  // by evidence condition first; score determines the order within each group.
  const preferred = failed ? (repeated ? 'change-approach' : 'inspect') :
    unverified ? 'verify' : verified ? 'advance' : 'inspect';
  const moves = ranks.map(move=>({ id:move.stepId, title:definitions.find(d=>d.id===move.stepId).title,
    score:move.score, preferred:move.stepId===preferred }))
    .sort((a,b)=>Number(b.preferred)-Number(a.preferred)||b.score-a.score);
  return {...base, reason: repeated?'REPEATED_KNOWN_FAILURE':failed?'KNOWN_FAILURE':
    unverified?'ACCEPTANCE_UNCONFIRMED':verified?'VERIFIED_ACTION':'INITIAL_OBSERVATION',
    moves, recommendedMove:moves[0].id };
}

export function adaptiveStrategyInstruction(mission) {
  const state = adaptiveMissionStrategy(mission);
  return [
    'CURRENT GAMEBOARD TACTICAL STRATEGY (heuristic recommendation, not authority or an execution graph):',
    JSON.stringify(state),
    state.status === 'HOLD'
      ? 'Do not start another mutation or retry an uncertain action. Respect the existing mission gate and reconcile from actual receipts.'
      : 'Compare the recommended posture and alternatives against the current goal, operator steering, tool availability and remaining budget. If assigned a graph move, preserve that move’s objective and dependencies; tactical suggestions do not replace the graph. Choose the next permitted action, not a new goal. After a known failure, diagnose the actual cause or choose a materially different route; never blindly repeat. After verification, advance the next unmet prerequisite or complete only if acceptance is satisfied. State a concise rationale in say, and use learned to describe what the receipt actually establishes.',
  ].join('\n');
}
