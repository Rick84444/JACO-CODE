// A shared presentation contract. Observations never become proof of completion.
// Only whitelisted fields enter the conversation; raw tool payloads stay in runtime.
export function safeCognitiveText(value, max = 600, secrets = []) {
  if (typeof value !== 'string') return '';
  let safe = value;
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 6) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/\b(?:wps_|ghp_|github_pat_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]')
    .slice(0, max);
}

export function cognitiveLink(value) {
  if (typeof value !== 'string' || /\[REDACTED\]/.test(safeCognitiveText(value, 4000))) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

const noise = /heartbeat|governor\.skipped|development_cycle|cycle\.started|worker\.(registered|heartbeat)|tick/i;
const labels = {
  'repo-read': 'Reading a file', 'repo-write': 'Creating a file', 'repo-edit': 'Changing the code', 'repo-list': 'Inspecting project files', 'repo-test': 'Running tests', 'web-fetch': 'Reading a web response',
  'read-file': 'Reading a file', 'write-file': 'Creating or changing a file',
  'apply-patch': 'Changing the code', 'list-files': 'Inspecting project files',
  'repo-scan': 'Mapping the project', 'git-status': 'Checking changes',
  'git-diff': 'Reviewing code differences', 'git-commit': 'Committing changes to Git',
  'git-push': 'Pushing changes to Git', 'run-tests': 'Running tests',
  'verify-api': 'Checking API responses', shell: 'Running a command in the workspace',
  'http-get': 'Reading a web response', 'web-search': 'Searching for information',
  'browser-open': 'Opening a page', 'browser-survey-site': 'Inspecting a page',
  'browser-click': 'Using the interface', 'browser-type': 'Filling in a field',
  'invoke-worker': 'Delegating a subtask', 'health-check': 'Checking the connection',
  screenshot: 'Reading a screenshot', 'desktop-observe': 'Inspecting the desktop',
};
const categories = {
  MISSION_CREATED: ['goal', 'Mission received'],
  NOVA_ACTION_STARTED: ['action', 'Work in progress'],
  NOVA_ACTION_RESULT: ['result', 'Result'],
  NOVA_PLANNING_RESULT: ['plan', 'Next step'],
  NOVA_REPLAN_REQUEST: ['decision', 'The plan needs to change'],
  NOVA_CANCEL_REQUEST: ['decision', 'Cancellation requested'],
  NOVA_OPERATOR_STEER: ['decision', 'New instruction queued'],
  NOVA_SPEND_BLOCKED: ['blocked', 'Payment awaiting your approval'],
  NOVA_CLAIM_CHECK: ['verification', 'Claim check'],
  'autonomy.replanned': ['decision', 'The plan has changed'],
  'runtime.degraded': ['blocked', 'Work is blocked'],
  'runtime.recovered': ['recovered', 'Connection restored'],
  'mission_graph.node.reconcile_terminal': ['verification', 'Sub-goal check'],
  'mission_graph.binding_quarantined': ['blocked', 'Mission state is unknown'],
  'governor.graph_created': ['goal', 'A new mission has been registered'],
};

export function toCognitiveEvent(raw, { durable = false, missionGoal = null, secrets = [] } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const clean=(value,max=600)=>safeCognitiveText(value,max,secrets);
  const type = String(raw.type || '');
  if (!type || noise.test(type)) return null;
  const payload = raw.payload || raw.receipt || {};
  const action = payload.action || payload.receipt || payload;
  const result = action.result || payload.result || {};
  const at = raw.at || raw.ts;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  const defined = categories[type];
  const category = defined?.[0] || (/failed|blocked|error/i.test(type) ? 'blocked' : /verified|verification/i.test(type) ? 'verification' : /result|executed/i.test(type) ? 'result' : /plan/i.test(type) ? 'plan' : 'observation');
  const title = defined?.[1] || ({blocked:'Work is blocked',verification:'Verification',result:'Result',plan:'Planning',observation:'New observation'})[category];
  const isResult = category === 'result' || category === 'verification';
  const unknown = action.outcomeUnknown === true || payload.outcomeUnknown === true || result.outcomeUnknown === true;
  const failed = action.ok === false || payload.ok === false || result.ok === false || Boolean(action.error || payload.error || result.error) || (Number.isFinite(result.exitCode) && result.exitCode !== 0) || /failed|error/i.test(type);
  const verified = isResult && !unknown && !failed && (action.ok === true || payload.ok === true) && (action.verified === true || payload.verified === true);
  const outcome = unknown ? 'unknown' : failed ? 'failed' : verified ? 'verified' : isResult ? 'unverified' : 'observed';
  const evidence = {
    outcome, path: clean(result.path || result.file || action.data?.path || payload.path, 400) || null,
    url: cognitiveLink(result.url), commit: clean(result.commit || result.commitHash || result.sha, 100) || null,
    exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
    error: clean(action.error || payload.error || result.error, 1000) || null,
  };
  let text = clean(raw.message);
  if (type === 'NOVA_ACTION_STARTED') text = (labels[action.type] || 'Running a tool step') + (evidence.path ? ': ' + evidence.path : '.');
  if (type === 'NOVA_ACTION_RESULT') {
    const verb = labels[action.type || payload.type] || 'Tool step';
    text = outcome === 'verified' ? verb + ': the result is verified.'
      : outcome === 'failed' ? verb + ': the step failed.' + (evidence.error ? ' ' + evidence.error : '')
      : outcome === 'unknown' ? verb + ': the outcome is unknown. Check before repeating the step.'
      : verb + ': done, but not verified.';
  }
  if (type === 'MISSION_CREATED') text = clean(payload.goal || missionGoal) || 'The mission is registered and waiting for planning.';
  if (type === 'NOVA_PLANNING_RESULT') text = clean(payload.error || payload.reason) || (payload.completionProposed ? 'A final result has been proposed. It must be checked against the evidence.' : 'The next step has been registered in the mission.');
  if (type === 'NOVA_REPLAN_REQUEST') text = clean(payload.reason) || 'The runtime has requested a new plan for the mission.';
  if (type === 'NOVA_CANCEL_REQUEST') text = 'The runtime has received the request. A running tool step may need to finish before the mission stops.';
  if (!text) text = clean(payload.reason || payload.summary);
  if (!text) return null;
  const seq = Number.isSafeInteger(raw.seq) && raw.seq > 0 ? raw.seq : null;
  const rawId = typeof raw.id === 'string' ? raw.id : null;
  if (!seq && !rawId) return null;
  const event = {
    id: durable && seq ? 'mission:' + seq : 'live:' + rawId,
    at, type, category, title, text, durable,
    seq: durable ? seq : null,
    missionId: clean(raw.missionId || payload.missionId, 200) || null,
    missionGoal: clean(missionGoal || raw.missionGoal, 300) || null,
    actionId: clean(action.id || action.actionId || payload.actionId, 200) || null,
    evidence,
  };
  // Configuration secrets may not follow a token prefix. Apply them to every displayed field.
  for (const key of ['text','missionGoal','missionId','actionId']) if (event[key]) event[key] = clean(event[key], 1000);
  event.text = event.text.replace(/\b(SEER|Nova|Aura)\b/g, 'JACO');
  for (const key of ['path','commit','error']) if (event.evidence[key]) event.evidence[key] = clean(event.evidence[key],1000);
  if (event.evidence.url && secrets.some(secret=>typeof secret==='string' && secret.length>=6 && event.evidence.url.includes(secret))) event.evidence.url=null;
  return event;
}

export function mergeCognitiveEvents(previous, incoming, limit = 400) {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) if (event?.id && typeof event.at === 'string') events.set(event.id, event);
  // Snapshot receipts may repeat bus events. Scope action IDs by mission and event type.
  const actions = new Map();
  for (const event of events.values()) {
      const key = event.actionId ? [event.missionId, event.type, event.actionId].join(':') : event.id;
      const existing = actions.get(key);
      if (!existing || (!existing.durable && event.durable)) actions.set(key,event);
  }
  return [...actions.values()].sort((a,b) => Date.parse(a.at) - Date.parse(b.at) || (a.seq && b.seq ? a.seq-b.seq : String(a.id).localeCompare(String(b.id)))).slice(-limit);
}

// The activation report owns readiness; a live event stream only proves connectivity.
export function activationReadiness({ report, loading = false, error = '' } = {}) {
  if (error) return { label:'Status unavailable', tone:'waiting', action:'retry', detail:'Check the connection and retry.' };
  if (loading || !report) return { label:'Checking readiness', tone:'waiting', action:'wait', detail:'Checking model, tools and agent runtime.' };
  if (!report.runtime?.up) return { label:'Start JACO', tone:'waiting', action:'retry', detail:'Start JACO on this computer and check the connection again.' };
  if (!report.providers?.some(provider => provider.active)) return { label:'Connect a model to begin', tone:'waiting', action:'connect', detail:'Select a local model or connect a model provider.' };
  if (report.planner?.reachable !== true) return { label:'Choose a working model', tone:'waiting', action:'connect', detail:'The selected planning model has not been verified.' };
  if (!report.tools?.toolCount) return { label:'Tools need to be started', tone:'waiting', action:'activate', detail:'Start connected tools so JACO can work in the project.' };
  if (!report.ok) return { label:'Agent runtime needs inspection', tone:'waiting', action:'details', detail:'The model responds, but not all execution requirements are met.' };
  return { label:'Ready for your mission', tone:'idle', action:'goal', detail:'Describe what you want done. You can follow the work here.' };
}

export function liveWorkspaceStatus({ connection, busy, missions = [], runtimeRunning, error, activation, approvalCount = 0 }) {
  if (error || connection === 'reconnecting' || connection === 'unavailable') return { label:'Connection needs recovery', tone:'waiting' };
  if (connection === 'connecting' && runtimeRunning == null) return { label:'Connecting to workspace', tone:'waiting' };
  if (approvalCount > 0) return { label:'Decision required', tone:'waiting' };
  if (busy) return { label:busy === 'goal' ? 'Registering mission' : busy === 'tool' ? 'Calling tools' : 'Waiting for model', tone:'active' };
  const mission = missions.find(m => m.status === 'ACTIVE');
  if (mission) return { label:({PLANNING:'Planning next step',EXECUTING:'Working',VERIFYING:'Verifying results',READY:'Waiting for next step'})[mission.phase] || 'Mission in progress', tone:'active' };
  if (missions.some(m => m.status === 'BLOCKED')) return { label:'Mission blocked', tone:'waiting' };
  if (missions.some(m => m.status === 'AWAITING_VERIFICATION')) return { label:'Result awaiting verification', tone:'waiting' };
  if (runtimeRunning === false) return { label:'Runtime paused', tone:'waiting' };
  return activationReadiness(activation);
}
