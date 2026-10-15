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
  graphs = null, providers = [], workers = [], missions = [], observedAt = new Date().toISOString(),
  graphError = null,
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
  return {
    schema: GAMEBOARD_FABRIC_SCHEMA,
    observedAt,
    authority: 'SEER Mission Graph + actual MCP host + durable mission bus',
    graphSource: graphs === null ? 'UNAVAILABLE' : 'OBSERVED',
    graphError: graphs === null ? clipped(graphError || 'SEER_NOT_CONNECTED', 200) : null,
    agents: uniqueIds(agents), tools: uniqueIds(tools), plans,
    missions: list(missions).slice(0, 30).map(m => ({
      identity: clipped(m.id), numericId: gameboardNumericId('mission', clipped(m.id)),
      status: clipped(m.status, 32), goal: clipped(m.goal || m.title, 260),
    })).filter(m => m.identity),
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
