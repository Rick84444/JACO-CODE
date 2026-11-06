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

// One plain sentence about what a finished step did. Used for the live text; the raw receipt stays in the evidence.
const where = value => { try { const u = new URL(String(value)); return u.host + (u.pathname === '/' ? '' : u.pathname).slice(0, 60); } catch { return ''; } };
const PLAIN_ERRORS = { NO_TARGET: 'the page has no such link or button', AMBIGUOUS_TARGET: 'more than one element matched', TARGET_NOT_FOUND: 'the field was not found', TARGET_NOT_UNIQUE: 'more than one field matched', STALE_PAGE: 'the page changed before the step ran', ORIGIN_DENIED: 'that page is not allowed', RUNTIME_HTTP_403: 'the browser connection refused the step', CLOUD_DISABLED_BY_POLICY: 'cloud models are switched off in the budget' };
function humanResult(type, result, evidence, clean) {
  const obs = result.observation || result;
  const title = clean(obs.title || result.title, 80);
  const place = where(obs.url || result.url);
  const quoted = title ? `${String.fromCharCode(8220)}${title}${String.fromCharCode(8221)}` : '';
  const raw = String(evidence.error || '');
  // For a failed command or test the useful part is what the program said, not "Command failed".
  const said = [result.stderr, result.stdout, result.output].map(v => String(v || '')).join('\n').split('\n').map(l => l.trim())
    .filter(l => /error|cannot|not found|failed|ENOENT|EPERM|expected|assert/i.test(l))[0] || '';
  const reason = Object.entries(PLAIN_ERRORS).find(([code]) => raw.includes(code))?.[1] || (said ? clean(said, 140) : clean(raw.split(/[\n:]/)[0], 100));
  const tail = (quoted || place) ? [quoted, place && `(${place})`].filter(Boolean).join(' ') : '';
  const out = { done: null, failed: null };
  if (type === 'browser-survey-site') out.done = tail ? `Opened ${tail} and read it.` : null;
  else if (type === 'browser-click') out.done = tail ? `Clicked and landed on ${tail}.` : 'Clicked.';
  else if (type === 'browser-type') out.done = 'Typed into the field.';
  else if (type === 'web-fetch') out.done = place ? `Fetched ${place}${title ? ': ' + quoted : ''}.` : null;
  else if (type === 'shell') out.done = Number.isFinite(result.exitCode) ? `The command finished (exit code ${result.exitCode}).` : null;
  else if (type === 'repo-read') out.done = evidence.path ? `Read ${evidence.path}.` : null;
  else if (type === 'repo-list') out.done = evidence.path ? `Listed ${evidence.path}.` : 'Listed the files.';
  else if (type === 'repo-write' || type === 'repo-edit') out.done = evidence.path ? `Saved ${evidence.path}.` : null;
  else if (type === 'repo-test') out.done = 'The tests passed.';
  else if (type === 'git-commit') out.done = 'Committed the change.';
  const label = { 'browser-survey-site': 'Could not open the page', 'browser-click': 'The click did not work', 'browser-type': 'Could not type into the field', 'web-fetch': 'Could not fetch the page', shell: 'The command failed', 'repo-test': 'The tests failed', 'repo-read': 'Could not read the file', 'repo-write': 'Could not save the file', 'repo-edit': 'Could not change the file' }[type];
  if (label) out.failed = reason ? `${label}: ${reason}.` : `${label}.`;
  return out;
}

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
  let title = defined?.[1] || ({blocked:'Work is blocked',verification:'Verification',result:'Result',plan:'Planning',observation:'New observation'})[category];
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
  if (type === 'NOVA_ACTION_STARTED') text = clean(payload.say, 300) || ((labels[action.type] || 'Running a tool step') + (evidence.path ? ': ' + evidence.path : '.'));
  if (type === 'NOVA_ACTION_RESULT') {
    const verb = labels[action.type || payload.type] || 'Tool step';
    // Say what happened in words a person can follow, not just that "the result is verified".
    const found = humanResult(action.type || payload.type, result, evidence, clean);
    text = outcome === 'failed' ? (found.failed || verb + ': the step failed.') + (evidence.error && !found.failed ? ' ' + evidence.error : '')
      : outcome === 'unknown' ? (found.done || verb).replace(/\.$/, '') + ': the outcome is unknown. Check before repeating the step.'
      : outcome === 'verified' ? (found.done || verb + ': the result is verified.')
      : (found.done || verb).replace(/\.$/, '') + ' (not verified yet).';
  }
  if (type === 'MISSION_CREATED') text = clean(payload.goal || missionGoal) || 'The mission is registered and waiting for planning.';
  if (type === 'NOVA_PLANNING_RESULT') {
    // The finished answer is the answer, not a "next step"; a planning pause with nothing to say is not shown.
    if (payload.completionProposed || payload.reason) title = 'Answer';
    else if (payload.error) title = 'Stopped';
    text = clean(payload.error || payload.reason) || (payload.completionProposed ? 'A final result has been proposed. It must be checked against the evidence.' : '');
  }
  if (type === 'NOVA_REPLAN_REQUEST') text = clean(payload.reason) || 'The runtime has requested a new plan for the mission.';
  if (type === 'NOVA_CANCEL_REQUEST') text = 'The runtime has received the request. A running tool step may need to finish before the mission stops.';
  if (!text) text = clean(payload.reason || payload.summary);
  // The step number gives the operator a sense of progress: what is being done now, and how far in the mission is.
  const stepNo = /:turn:(\d+)$/.exec(String(action.id || action.actionId || payload.actionId || ''))?.[1];
  if (text && stepNo && (type === 'NOVA_ACTION_STARTED' || type === 'NOVA_ACTION_RESULT')) text = `Step ${stepNo}: ${text}`;
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
