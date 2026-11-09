import { createHash } from 'node:crypto';
import { createStrategicBoard, simulateStrategicBoard, rankStrategicMoves } from './aura-strategic-board.mjs';

export const GAMEBOARD_FABRIC_SCHEMA = 'jaco.gameboard-fabric/v1';

// IDs are routing/identity handles, not trust scores, permissions or evidence of availability.
// SHA-256/48-bit stays an exact safe integer in JS and is portable to JSON clients.
export function gameboardNumericId(kind, identity) {
  const type = String(kind || '');
  const value = String(identity || '');
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(type) || !value || value.length > 512) throw Error('GAMEBOARD_ID_INVALID');
  return Number.parseInt(createHash('sha256').update(type + '\0' + value).digest('hex').slice(0, 12), 16);
}

const list = value => Array.isArray(value) ? value : [];
const clipped = (value, max = 200) => String(value ?? '').slice(0, max);
const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
function uniqueIds(items) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.numericId) && seen.get(item.numericId) !== item.identity) throw Error('GAMEBOARD_NUMERIC_ID_COLLISION');
    seen.set(item.numericId, item.identity);
  }
  return items;
}

export function gameboardProjection({
  graphs = null, providers = [], workers = [], missions = [], events = [], primaryGoal = null,
  observedAt = new Date().toISOString(), graphError = null,
} = {}) {
  const tools = [];
  for (const provider of list(providers)) {
    const sourceId = clipped(provider.id, 120);
    if (!sourceId) continue;
    for (const tool of list(provider.tools)) {
      const name = clipped(tool.name, 120);
      if (!name) continue;
      const identity = 'mcp:' + sourceId + ':' + name;
      const statistics = provider.stats || {};
      tools.push({
        identity, numericId: gameboardNumericId('tool', identity), providerId: sourceId, name,
        status: clipped(provider.status || 'UNKNOWN', 30),
        readOnly: tool.readOnly === true,
        agentAllowed: tool.agentAllowed === true,
        observed: true,
        availability: 'ADVERTISED_NOT_EXECUTION_VERIFIED',
        metrics: {
          calls: Number.isSafeInteger(statistics.calls) ? statistics.calls : null,
          failures: Number.isSafeInteger(statistics.failures) ? statistics.failures : null,
          latencyMs: Number.isFinite(statistics.lastCall?.ms) ? statistics.lastCall.ms : null,
          cost: null, successProbability: null,
        },
      });
    }
  }
  const agents = list(workers).map(worker => {
    const identity = clipped(worker.id || worker.workerId || worker.name || worker.agentId, 160);
    if (!identity) return null;
    return { identity, numericId: gameboardNumericId('agent', identity),
      status: clipped(worker.status || worker.state || 'UNKNOWN', 30),
      capabilities: list(worker.capabilities).map(c => clipped(c, 100)),
    };
  }).filter(Boolean);
  const plans = list(graphs).slice(0, 30).map(graph => {
    const identity = clipped(graph.id, 160);
    const board = graph.strategic_board || graph.policy?.strategic_board || null;
    const nodes = list(graph.nodes).map(node => ({
      identity: clipped(node.key, 160),
      numericId: gameboardNumericId('move', identity + ':' + clipped(node.key, 160)),
      title: clipped(node.title, 220),
      status: clipped(node.status, 32),
      priority: Number.isFinite(node.priority) ? node.priority : null,
      dependencies: list(node.dependencies).map(String),
      evidenceRefs: list(node.evidence_refs).map(ref => clipped(ref, 300)),
    }));
    return { identity, numericId: gameboardNumericId('mission', identity),
      objective: clipped(graph.objective, 500), status: clipped(graph.status, 32),
      nodes,
      simulation: board?.forecast ? {
        status: 'SIMULATED', source: 'SEER_STRATEGIC_FORECAST', forecast: board.forecast,
        observedOutcome: false, note: 'Estimated scenario values are not execution receipts',
      } : { status: 'UNAVAILABLE', reason: 'NO_STRATEGIC_FORECAST_OBSERVED' },
      moves: list(board?.moves || board?.recommendedMoves).slice(0, 20).map(m => ({
        identity: clipped(m.stepId), numericId: gameboardNumericId('move', identity + ':' + clipped(m.stepId)),
        score: Number.isFinite(m.score) ? m.score : null,
        executable: m.executable === true, blockedBy: list(m.blockedBy).map(String),
      })),
    };
  }).filter(graph => graph.identity);
  // The SEER graph, the durable Mission Bus and the operator goal are different
  // sources. A registered goal must remain visible even before SEER produces a graph.
  // Never fabricate graph nodes, verification receipts or model performance.
  const goalText = clipped(typeof primaryGoal === 'string' ? primaryGoal : primaryGoal?.statement || '', 600).trim();
  const recentMissions = list(missions).slice(0, 30).filter(m => clipped(m?.id)).map(m => {
    const receipts = list(m.receipts);
    const verifiedActions = receipts.filter(r => r?.ok === true && r?.verified === true).length;
    const lastFailure = [...receipts].reverse().find(r => r?.ok === false && r?.error);
    return {
      identity: clipped(m.id, 160), numericId: gameboardNumericId('mission', clipped(m.id, 160)),
      status: clipped(m.status, 32), goal: clipped(m.goal || m.title, 260),
      source: clipped(m.source, 80), phase: clipped(m.phase, 40) || null,
      updatedAt: clipped(m.updatedAt, 60) || null,
      actionCount: receipts.length, verifiedActions,
      reviewAvailable: m.reviewAvailable === true,
      lastError: lastFailure ? clipped(lastFailure.error, 260) : null,
      evidenceStatus: verifiedActions ? 'VERIFIED_ACTION_RECEIPTS' : 'NO_VERIFIED_ACTION_RECEIPTS',
    };
  });
  // Derive observations from the append-only Mission Bus, not from the separate
  // hypothesis exchange. Display only allowlisted scalars, never raw payloads.
  const observedEvents = list(events).filter(e =>
    Number.isSafeInteger(e?.seq) && /^(MISSION_|NOVA_|TICKET_)/.test(String(e.type || '')))
    .slice(0, 40).map(e => {
      const type = clipped(e.type, 80);
      const result = e.payload && typeof e.payload === 'object' ? e.payload : {};
      const verified = type === 'NOVA_ACTION_RESULT' && result.ok === true && result.verified === true;
      const failed = type === 'NOVA_ACTION_RESULT' && result.ok === false;
      const refused = type === 'NOVA_PLANNING_RESULT' && Boolean(result.error);
      return {
        id: 'bus:' + e.seq, numericId: gameboardNumericId('event', 'bus:' + e.seq),
        type, at: clipped(e.ts, 60) || null, missionId: clipped(e.missionId, 160) || null,
        taskType: clipped(result.type, 80) || null,
        outcome: verified ? 'VERIFIED' : failed ? 'FAILED' : refused ? 'BLOCKED' : 'OBSERVED',
        error: (failed || refused) ? clipped(result.error, 220) || null : null,
        evidenceRef: 'bus:' + e.seq,
      };
    });
  const blockedMission = recentMissions.find(m => m.status === 'BLOCKED' || m.status === 'FAILED');
  const activeMission = recentMissions.find(m => m.status === 'ACTIVE');
  const next = blockedMission
    ? { code: 'MISSION_NEEDS_RECOVERY', missionId: blockedMission.identity, text: 'Inspect the blocked mission and its receipts before resuming.' }
    : activeMission
      ? { code: 'MISSION_RUNNING_OR_QUEUED', missionId: activeMission.identity, text: 'Inspect the active mission phase and next verified result.' }
      : goalText && !plans.length
        ? { code: 'GOAL_AWAITING_GRAPH', missionId: null, text: 'Goal recorded; no SEER planning graph or executable steps observed yet.' }
        : plans.length
          ? { code: 'PLAN_AWAITING_EXECUTION', missionId: null, text: 'A graph exists; no active mission is observed on this runtime.' }
          : { code: 'NO_ACTIVE_WORK_OBSERVED', missionId: null, text: 'No goal or active mission is observed.' };
  return {
    schema: GAMEBOARD_FABRIC_SCHEMA,
    observedAt,
    authority: 'Aura mission graph + MCP host + durable mission bus',
    strategy: { ownerId: 'aura', functionId: 'plan' },
    graphSource: graphs === null ? 'UNAVAILABLE' : !list(graphs).length ? 'OBSERVED_EMPTY' : 'OBSERVED',
    graphError: graphs === null ? clipped(graphError || 'SEER_NOT_CONNECTED', 200) : null,
    agents: uniqueIds(agents), tools: uniqueIds(tools), plans,
    operatorGoal: goalText ? { statement: goalText, status: 'RECORDED_NOT_EXECUTION_VERIFIED', source: 'AURA_OPERATOR_GOAL' } : null,
    missions: recentMissions, activity: observedEvents, next,
    numericIdSemantics: 'stable identifiers only; not permissions, measured performance or scores',
  };
}

// Pure scenario calculation. Never dispatches an executor or marks a work unit VERIFIED.
export function simulateGameboardScenario(input = {}) {
  if (!input || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 40)
    throw Error('GAMEBOARD_SCENARIO_STEPS_REQUIRED_1_TO_40');
  if (input.obstacles !== undefined && (!Array.isArray(input.obstacles) || input.obstacles.length > 40))
    throw Error('GAMEBOARD_SCENARIO_OBSTACLES_INVALID');
  const goalId = clipped(input.goalId || 'scenario:goal', 160);
  const missionId = clipped(input.missionId || 'scenario:mission', 160);
  const steps = input.steps.map((step, i) => {
    const id = clipped(step?.id || 'step-' + (i + 1), 150);
    if (step?.status && !['PENDING','READY','BLOCKED','RUNNING','VERIFIED','FAILED'].includes(step.status))
      throw Error('GAMEBOARD_SCENARIO_STATUS_INVALID');
    const metrics = ['goalImpact','verificationGain','informationGain','confidence','risk','effort'];
    for (const key of metrics) if (metric(step?.[key]) === null) throw Error('GAMEBOARD_SCENARIO_METRIC_REQUIRED:' + id + ':' + key);
    return { ...step, id, status: step.status || 'PENDING' };
  });
  const board = createStrategicBoard({goalId,missionId,steps,obstacles: input.obstacles || []});
  return {
    schema: 'jaco.gameboard-simulation/v1', status: 'SIMULATED', executed: false, verified: false,
    assumptions: 'Input probabilities and utilities supplied by caller; not empirically calibrated by this operation',
    source: 'AURA_STRATEGIC_BOARD_V1',
    result: simulateStrategicBoard(board), recommendedMoves: rankStrategicMoves(board).slice(0, 12),
  };
}
