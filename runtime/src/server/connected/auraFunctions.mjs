// Aura is the only operator-facing agent identity. These are capabilities of the
// existing runtime, not independently spawned agents or a second scheduler.
// This module is read-only: it never grants permissions or executes a mission.
export const AURA_FUNCTION_DEFINITIONS = Object.freeze([
  { id: 'reason', name: 'Reasoning', implementation: 'Planner + selected model', authority: 'model-inference', reads: ['health'] },
  { id: 'plan', name: 'Planning', implementation: 'Task planner', authority: 'existing-goal-contract', reads: ['seer_goals'] },
  { id: 'execute', name: 'Execution', implementation: 'Persistent task executor', authority: 'existing-mission-lease', reads: ['mission_list', 'mission_get'] },
  { id: 'memory', name: 'Memory', implementation: 'Project memory stores', authority: 'existing-memory-policy', reads: ['seer_memory'] },
  { id: 'tools', name: 'Tools', implementation: 'MCP connections', authority: 'existing-tool-policy', reads: ['repo_list', 'git_status'] },
  { id: 'verify', name: 'Verification', implementation: 'Task results and acceptance checks', authority: 'evidence-before-claim', reads: ['mission_get', 'runtime_events'] },
]);

const observed = (ready, fallback = 'UNOBSERVED') => ready ? 'OBSERVED' : fallback;

export function projectAuraFunctions({ workplace = null, coordinator = null, graphs = null,
  missions = null, workers = [], tools = null, now = new Date().toISOString(), safeText = value => String(value ?? '').slice(0, 200) } = {}) {
  const workplaceReachable = workplace?.reachable === true;
  const seerReachable = coordinator?.reachable === true;
  const model = seerReachable ? coordinator?.health?.local_model : null;
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
    reason: seerReachable ? observed(Boolean(model?.model), 'NO_MODEL_OBSERVED') : 'UNAVAILABLE',
    plan: !seerReachable ? 'UNAVAILABLE' : observed(Array.isArray(graphs), 'UNOBSERVED'),
    execute: !visibleMissions ? 'UNAVAILABLE' : freshWorkers > 0 ? 'OBSERVED' : active.length ? 'NO_WORKER_OBSERVED' : 'IDLE',
    memory: !workplaceReachable ? 'UNAVAILABLE' : observed(Boolean(workplace?.memoryState), 'UNOBSERVED'),
    tools: !toolRows ? 'UNOBSERVED' : connectedTools > 0 ? 'OBSERVED' : 'ON_DEMAND',
    verify: !visibleMissions ? 'UNAVAILABLE' : verifiedSteps > 0 ? 'EVIDENCE_OBSERVED' : 'NO_EVIDENCE_OBSERVED',
  };
  const detail = {
    reason: model?.model ? safeText(model.model) : 'No working inference verified',
    plan: Array.isArray(graphs) ? String(graphs.length) + ' observed task plans' : 'Task plans have not been observed',
    execute: String(active.length) + ' active tasks, ' + String(freshWorkers) + ' recently observed workers',
    memory: workplace?.memoryState?.storage ? safeText(workplace.memoryState.storage) : 'Memory store not verified',
    tools: connectedTools === null ? 'Tool status unavailable' : String(connectedTools) + ' connected tool servers; tool execution has not been verified',
    verify: verifiedSteps === null ? 'Task results cannot be read' : String(verifiedSteps) + ' tool steps reported as verified; task completion is checked separately',
  };
  return {
    schema: 'jaco.aura-functions/v1',
    observedAt: now,
    identity: { id: 'aura', name: 'Aura', agentCount: 1, meaning: 'operator-facing-identity-only' },
    // Internal SEER/Nova/Workplace processes and historical agent records remain
    // observable in technical diagnostics; do not misreport reduced process count.
    runtimeConsolidated: false,
    functions: AURA_FUNCTION_DEFINITIONS.map(def => ({
      ...def, state: states[def.id], detail: detail[def.id],
    })),
  };
}
