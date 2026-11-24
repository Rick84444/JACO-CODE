// Aura is the only agent identity, including internally. These are capabilities of the
// existing runtime, not independently spawned agents or a second scheduler.
// This module is read-only: it never grants permissions or executes a mission.
export const AURA_FUNCTION_DEFINITIONS = Object.freeze([
  { id: 'reason', name: 'Reasoning', implementation: 'Aura Model Runtime', authority: 'model-inference', reads: ['health'] },
  { id: 'plan', name: 'Planning', implementation: 'Aura Strategy Runtime', authority: 'existing-goal-contract', reads: ['seer_goals'] },
  { id: 'execute', name: 'Execution', implementation: 'Aura Durable Execution', authority: 'existing-mission-lease', reads: ['mission_list', 'mission_get'] },
  { id: 'memory', name: 'Memory', implementation: 'Aura Memory + Workplace', authority: 'existing-memory-policy', reads: ['seer_memory'] },
  { id: 'tools', name: 'Tools', implementation: 'MCP Tool Fabric', authority: 'existing-tool-policy', reads: ['repo_list', 'git_status'] },
  { id: 'verify', name: 'Verification', implementation: 'Mission receipts + contract gates', authority: 'evidence-before-claim', reads: ['mission_get', 'runtime_events'] },
]);

const observed = (ready, fallback = 'UNOBSERVED') => ready ? 'OBSERVED' : fallback;

export function projectAuraFunctions({ workplace = null, coordinator = null, graphs = null,
  missions = null, workers = [], tools = null, planner = null, now = new Date().toISOString(), safeText = value => String(value ?? '').slice(0, 200) } = {}) {
  const workplaceReachable = workplace?.reachable === true;
  const seerReachable = coordinator?.reachable === true;
  const model = seerReachable ? coordinator?.health?.local_model : null;
  // With the unified Aura runtime SEER has no local model on purpose; Aura reasons with the model the operator chose,
  // which is saved only after it answered a test request. That saved choice is the inference evidence here.
  const chosen = !model?.model && planner?.by === 'operator' && planner.provider && planner.model ? planner : null;
  const visibleMissions = Array.isArray(missions) ? missions : null;
  const active = visibleMissions?.filter(m => m.status === 'ACTIVE') || [];
  const verifiedSteps = visibleMissions?.reduce((n, mission) =>
    n + (mission.receipts || []).filter(receipt => receipt.verified === true && receipt.ok === true && !receipt.outcomeUnknown).length, 0) ?? null;
  const freshWorkers = (Array.isArray(workers) ? workers : []).filter(worker => {
    const at = Date.parse(worker.heartbeatAt || '');
    return Number.isFinite(at) && Number.isFinite(Date.parse(now)) && Date.parse(now) - at >= 0 && Date.parse(now) - at <= 180000;
  }).length;
  const toolRows = Array.isArray(tools) ? tools : null;
  const connectedTools = toolRows?.filter(tool => tool.status === 'READY').length ?? null;
  const states = {
    reason: chosen ? 'OBSERVED' : seerReachable ? observed(Boolean(model?.model), 'NO_MODEL_OBSERVED') : 'UNAVAILABLE',
    plan: !seerReachable ? 'UNAVAILABLE' : observed(Array.isArray(graphs), 'UNOBSERVED'),
    execute: !visibleMissions ? 'UNAVAILABLE' : freshWorkers > 0 ? 'OBSERVED' : active.length ? 'NO_WORKER_OBSERVED' : 'IDLE',
    memory: !workplaceReachable ? 'UNAVAILABLE' : observed(Boolean(workplace?.memoryState), 'UNOBSERVED'),
    tools: !toolRows ? 'UNOBSERVED' : connectedTools > 0 ? 'OBSERVED' : 'ON_DEMAND',
    verify: !visibleMissions ? 'UNAVAILABLE' : verifiedSteps > 0 ? 'EVIDENCE_OBSERVED' : 'NO_EVIDENCE_OBSERVED',
  };
  const detail = {
    reason: model?.model ? safeText(model.model) : chosen ? `${safeText(chosen.provider)}/${safeText(chosen.model)} · answered a test request when chosen${chosen.at ? ` (${safeText(chosen.at)})` : ''}` : 'No working inference verified',
    plan: Array.isArray(graphs) ? String(graphs.length) + ' observed plan graphs' : 'Plan graphs not observed',
    execute: String(active.length) + ' active missions, ' + String(freshWorkers) + ' fresh worker processes',
    memory: workplace?.memoryState?.storage ? safeText(workplace.memoryState.storage) : 'Memory layer not verified',
    tools: connectedTools === null ? 'Tool status missing' : String(connectedTools) + ' connected MCP servers; no calls guaranteed',
    verify: verifiedSteps === null ? 'Receipts cannot be read' : String(verifiedSteps) + ' reported verified tool steps; not proof of the final goal',
  };
  return {
    schema: 'jaco.aura-functions/v1',
    observedAt: now,
    identity: { id: 'aura', name: 'Aura', agentCount: 1, meaning: 'sole-agent' },
    // Legacy planning/execution and Workplace processes are technical service
    // owners, not agents. Remain observable during migration; do not fabricate
    // runtime consolidation before validated in-process state ownership.
    runtimeConsolidated: false,
    functions: AURA_FUNCTION_DEFINITIONS.map(def => ({
      ...def, state: states[def.id], detail: detail[def.id],
    })),
  };
}
