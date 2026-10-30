import { projectAgentNetwork } from './agentNetwork.mjs';
import { projectAuraFunctions } from './auraFunctions.mjs';
import { projectAuraOversight } from './auraOversight.mjs';
import { redactSensitive } from '../continuum/util.mjs';

export function boardColumn(status, phase) {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'DONE') return 'done';
  if (status === 'AWAITING_VERIFICATION') return 'review';
  if (status === 'BLOCKED') return 'blocked';
  if (status === 'ACTIVE') return ['PLANNING', 'EXECUTING'].includes(phase) ? 'running' : phase === 'READY' ? 'queue' : 'unknown';
  return 'unknown';
}

// Only selected fields cross the operator UI boundary. Never forward raw cards,
// sessions, observations, tool arguments or arbitrary result objects.
export function buildAgentBoard({ bus, control, workplace, graphs = null, coordinator = null, workers = [], tools = null, services = null, now = new Date().toISOString(), secrets = [] }) {
  const text = (value, max = 1000) => {
    if (typeof value !== 'string') return null;
    let safe = redactSensitive(value).replace(/\b(?:wps_|ghp_|github_pat_)[A-Za-z0-9_]+/g, '[REDACTED]')
      .replace(/\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]');
    for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 6) safe = safe.split(secret).join('[REDACTED]');
    return safe.slice(0, max);
  };
  const strings = (value, max = 20) => Array.isArray(value) ? value.slice(0, max).map(v => text(v, 240)).filter(Boolean) : [];
  const number = v => Number.isFinite(v) ? v : null;
  const receipt = r => {
    const result = r?.result || {};
    return {
      actionId: text(r?.actionId, 240), type: text(r?.type, 100), at: text(r?.at, 80),
      ok: r?.ok === true, verified: r?.verified === true, outcomeUnknown: r?.outcomeUnknown === true,
      expectedOutcome: text(r?.expectedOutcome, 1000), error: text(r?.error, 500),
      result: {
        kind: text(result.kind, 80), status: number(result.status), exitCode: number(result.exitCode),
        commit: text(result.commit || result.commitHash || result.sha, 100),
        path: text(result.path || result.file, 300), sha256: text(result.sha256, 100),
        evidenceRefs: strings(result.evidenceRefs),
      },
    };
  };
  const agents = (workplace?.agents || []).map(a => ({
    agentId: text(a.agentId, 240), stableId:text(a.stableId,160), name: text(a.name, 160), role: text(a.role, 160),
    model: text(a.model,200), status: text(a.status, 80), liveSessions: number(a.liveSessions), lastSeenAt: text(a.lastSeenAt, 80),
    permissions: Object.fromEntries(Object.entries(a.permissions || {}).filter(([, v]) => typeof v === 'boolean').slice(0, 80).map(([k,v]) => [text(k,100),v])),
    tools: strings(a.tools, 40),
    sessions: (a.sessions || []).map(s => ({status:text(s.status,80),environment:text(s.environment,160),lastSeenAt:text(s.lastSeenAt,80)})),
  }));
  let missions = [], total = null, statusCounts = null, missionError = null;
  try {
    statusCounts = bus.missionStatusCounts();
    total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    missions = bus.listMissions(200).map(base => {
      let full = base, detailError = null;
      try { full = control.get(base.id); } catch { detailError = 'SESSION_DETAILS_UNAVAILABLE'; }
      const lastAction = bus.lastMissionEvent(base.id, 'NOVA_ACTION_RESULT');
      const lastPlan = bus.lastMissionEvent(base.id, 'NOVA_PLANNING_RESULT');
      const session = bus.db.prepare('SELECT owner FROM nova_sessions WHERE mission_id=?').get(base.id);
      const records = (full.receipts || []).slice(-40).map(receipt);
      const last = lastAction ? receipt(lastAction.payload) : records.at(-1) || null;
      const owner = text(session?.owner, 240);
      const agent = owner ? agents.find(a => a.agentId === owner) : null;
      const phase = text(full.phase, 80);
      return {
        id: text(base.id, 240), goal: text(base.goal, 12000), status: text(base.status, 80), phase,
        column: boardColumn(base.status, phase), executor: text(base.metadata?.executor, 160),
        owner, agentId: agent?.agentId || null, createdAt: text(base.createdAt, 80), updatedAt: text(base.updatedAt, 80),
        lastActivityAt: text(lastPlan && (!lastAction || lastPlan.ts > lastAction.ts) ? lastPlan.ts : lastAction?.ts || base.updatedAt, 80),
        planningError: text(lastPlan?.payload?.error, 500),
        completionReason: lastPlan?.payload?.completionProposed ? text(lastPlan.payload.reason, 3000) : null,
        failures: number(full.failures), turn: number(full.turn), detailError,
        contractStatus: full.contractStatus ? {
          machineVerified: full.contractStatus.machineVerified === true,
          missing: strings(full.contractStatus.missing),
        } : null,
        execution: full.execution ? {phase:text(full.execution.phase,80),verifiedActions:number(full.execution.verifiedActions),failedActions:number(full.execution.failedActions),remaining:strings(full.execution.remaining),recovery:full.execution.recovery ? {code:text(full.execution.recovery.code,200),next:text(full.execution.recovery.next,500)} : null} : null,
        preflight: full.preflight ? {status:text(full.preflight.status,80),at:text(full.preflight.at,80),blockers:strings(full.preflight.blockers),knowledgeRecords:number(full.preflight.knowledgeRecords)} : null,
        cancelRequested: full.cancelRequested === true,
        replanRequest: full.replanRequest ? {reason:text(full.replanRequest.reason,1000),subgoals:(full.replanRequest.subgoals || []).slice(0,8).map(s=>({title:text(s.title,300),objective:text(s.objective,2000)}))} : null,
        lastResult: last, receipts: records,
        blocker: base.status === 'BLOCKED' ? text(full.replanRequest?.reason || lastPlan?.payload?.error || last?.error || (last?.outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'Operator resolution required'), 500) : null,
      };
    });
  } catch { missionError = 'MISSION_STORE_UNAVAILABLE'; }
  return {
    success: true, schema: 'jaco.aura-agent-board/v1', observedAt: now,
    sources: {
      workplace: { available: workplace?.reachable === true, observedAt: workplace?.reachable ? now : null, error: workplace?.reachable ? null : 'WORKPLACE_UNAVAILABLE' },
      missions: { available: missionError === null, observedAt: missionError ? null : now, error: missionError },
    },
    summary: workplace?.reachable ? {
      connected: agents.filter(a => (a.liveSessions || 0) > 0).length,
      reportingWork: agents.filter(a => (a.liveSessions || 0) > 0 && (a.sessions.some(s => s.status === 'BUSY') || a.status === 'BUSY')).length,
      offline: agents.filter(a => !(a.liveSessions > 0)).length,
      activeMissions: missionError ? null : Number(statusCounts?.ACTIVE || 0),
    } : null,
    memory: (workplace?.memory || []).slice(0,30).map(e => ({id:text(e.eventId,240),kind:text(e.kind,80),body:text(e.body,3000),at:text(e.createdAt,80),agentId:text(e.sender?.agentId,240)})),
    memoryState: workplace?.memoryState ? {owner:'Workplace',git:false,storage:text(workplace.memoryState.storage,80),latestSeq:number(workplace.memoryState.latestSeq)} : null,
    aura: {
      ...projectAuraFunctions({ workplace, coordinator, graphs, missions: missionError ? null : missions, workers, tools, now, safeText: text }),
      oversight: projectAuraOversight({ serviceHealth: services, statusCounts,
        missions: missionError ? null : missions, truncated: total !== null && total > missions.length, now }),
    },
    network: projectAgentNetwork({agents,missions,graphs,coordinator,workers,missionTruncated:total !== null && total > missions.length,text,now}),
    agents, missions, total, statusCounts, limit: 200, truncated: total !== null && total > missions.length,
  };
}
