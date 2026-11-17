// `jaco activate` (operator 2026-10-13: "I don't know if the tools work, and the provider should be
// selectable... create an activation command"). After the stack is up this starts every MCP tool server
// that is stopped, asks which model providers really answer, reads the planner choice the GUI made, and
// returns one report that says what works and what does not. Nothing here is assumed: every line comes
// from a request that was made.
const SERVER_START_CONCURRENCY = 3;

async function call(fetchImpl, baseUrl, token, method, route, body, timeoutMs = 60_000) {
  const res = await fetchImpl(`${baseUrl}${route}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-gateway-token': token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(typeof data.error === 'string' ? data.error : `HTTP_${res.status}`);
  return data;
}
const errorText = error => String(error?.message || error).split('\n')[0].slice(0, 160);

async function runtimeIdentity(baseUrl, fetchImpl) {
  try { return await call(fetchImpl, baseUrl, '', 'GET', '/api/runtime/identity', null, 4000); }
  catch { return null; }
}
export async function runtimeUp({ baseUrl, fetchImpl = fetch } = {}) {
  const identity = await runtimeIdentity(baseUrl, fetchImpl);
  return identity ? identity.version || true : false;
}

/**
 * @param {{ baseUrl?: string, workplaceUrl?: string, sentinelUrl?: string, token?: string, fetchImpl?: typeof fetch, startTools?: boolean, requireWorkplace?: boolean, requireSupervisor?: boolean }} [o]
 */
export async function activationReport({
  baseUrl = 'http://127.0.0.1:3000',
  workplaceUrl = process.env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995',
  sentinelUrl = process.env.JACO_SENTINEL_URL || 'http://127.0.0.1:2999',
  token = '',
  fetchImpl = fetch,
  startTools = true,
  requireWorkplace,
  requireSupervisor,
  lite,
} = {}) {
  const identity = await runtimeIdentity(baseUrl, fetchImpl);
  // Trust the responding Core's profile rather than the shell launching the CLI.
  // Older builds retain the explicit option/environment fallback.
  lite = identity?.executionProfile === 'lite' ? true : identity?.executionProfile === 'full' ? false : (lite ?? process.env.JACO_LITE === '1');
  requireWorkplace ??= typeof identity?.workplaceRequired === 'boolean' ? identity.workplaceRequired
    : process.env.JACO_WORKPLACE_REQUIRED != null ? process.env.JACO_WORKPLACE_REQUIRED !== '0' : !lite;
  requireSupervisor ??= !lite && (Boolean(process.env.TERMUX_VERSION) || /com\.termux/.test(process.env.PREFIX || ''));
  const report = {
    schema: 'jaco.activation/v2',
    at: new Date().toISOString(),
    runtime: { up: false, version: null },
    executor: { owner: lite ? 'lite-launcher' : 'workplace-supervisor', state: 'UNVERIFIED', observedAt: null },
    workplace: { required: requireWorkplace, up: false, state: null, novaState: null },
    supervisor: { required: requireSupervisor, up: null, state: null },
    tools: { servers: [], ready: 0, toolCount: 0 },
    providers: [],
    planner: null,
    problems: [],
    ok: false,
  };
  if (!identity) { report.problems.push('The JACO runtime is not answering. Start the stack with: jaco activate'); return report; }
  report.runtime = { up: true, version: identity.version || null, executionProfile: lite ? 'lite' : 'full' };

  // On Termux, functional HTTP health is not enough: Sentinel/jacoctl owns the canonical runit tree.
  // A stray/orphan Core must never be allowed to make the product report READY.
  if (requireSupervisor) {
    try {
      const sentinel = await call(fetchImpl, sentinelUrl.replace(/\/+$/, ''), '', 'GET', '/api/system/status', null, 5000);
      const state = String(sentinel?.status?.state || sentinel?.status?.supervisor || 'UNKNOWN');
      report.supervisor = { required: true, up: true, state };
      if (state !== 'READY') report.problems.push(`The canonical supervisor is not READY (${state}).`);
    } catch (error) {
      report.supervisor = { required: true, up: false, state: 'UNAVAILABLE' };
      report.problems.push(`Sentinel/supervisor is not answering: ${errorText(error)}`);
    }
  } else {
    report.supervisor = { required: false, up: null, state: 'NOT_REQUIRED' };
  }

  // In Lite the separately launched worker is mandatory even when coordination is optional.
  // A heartbeat only proves a recent worker observation, not successful inference or mission completion.
  if (lite) {
    try {
      const health = await call(fetchImpl, baseUrl, token, 'GET', '/api/connected/nova/executor-health', null, 4000);
      if (health.schema !== 'jaco.nova-executor-health/v1' || health.state !== 'RUNNING' ||
          !Number.isFinite(Date.parse(health.observedAt))) throw new Error('NO_FRESH_EXECUTOR_HEARTBEAT');
      report.executor = { owner: 'lite-launcher', state: 'RUNNING', observedAt: health.observedAt };
    } catch (error) {
      report.problems.push('The durable executor managed by the separate Lite launcher has not been verified. Check Lite lifecycle and .jaco/nova.log.');
    }
  }
  // Required coordination is independent of the launcher-managed executor in Lite.
  // Full runtime retains mandatory supervised Nova when Workplace is required.
  if (requireWorkplace) {
    try {
      const health = await call(fetchImpl, workplaceUrl.replace(/\/+$/, ''), '', 'GET', '/health', null, 4000);
      const supervised = health?.supervisedAgents || {};
      // Lite owns the Nova child from its launcher, not the Workplace
      // supervisor. DISABLED is therefore not evidence of a stopped worker.
      // Do not declare READY either: only the launcher can attest its child.
      const liteExternal = lite;
      report.workplace = {
        required: true, up: true,
        state: liteExternal ? String(health?.status || 'UNKNOWN') : supervised.state || health?.status || null,
        novaState: liteExternal ? (report.executor.state === 'RUNNING' ? 'RUNNING' : 'EXTERNAL_UNVERIFIED') : supervised.nova?.state || null,
        externalExecutor: liteExternal,
      };
      if (liteExternal) {
        if (health?.status !== 'READY') report.problems.push('Required Lite Workplace coordination is not READY.');
      } else if (supervised.state !== 'RUNNING' || supervised.nova?.state !== 'RUNNING') {
        report.problems.push(`Workplace/Durable Nova is not RUNNING (workplace=${supervised.state || 'UNKNOWN'}, nova=${supervised.nova?.state || 'UNKNOWN'}).`);
      } else {
        report.executor = { owner: 'workplace-supervisor', state: 'RUNNING', observedAt: new Date().toISOString() };
      }
    } catch (error) {
      report.workplace = { required: true, up: false, state: null, novaState: null };
      report.problems.push(`Workplace is not answering: ${errorText(error)}`);
    }
  } else {
    report.workplace = { required: false, up: null, state: 'NOT_REQUIRED', novaState: 'NOT_REQUIRED' };
  }

  // Tools: start what is stopped, then count what answers.
  try {
    const listed = await call(fetchImpl, baseUrl, token, 'GET', '/api/mcp/tools');
    const queue = (listed.servers || []).map(s => ({ id: String(s.id), status: String(s.status || ''), tools: Array.isArray(s.tools) ? s.tools.length : 0, agentAccess: s.agentAccess }));
    const todo = startTools ? queue.filter(s => s.status !== 'READY' && s.agentAccess !== 'off') : [];
    for (let i = 0; i < todo.length; i += SERVER_START_CONCURRENCY) {
      await Promise.all(todo.slice(i, i + SERVER_START_CONCURRENCY).map(async server => {
        try {
          const started = await call(fetchImpl, baseUrl, token, 'POST', '/api/mcp/start', { server: server.id }, 90_000);
          Object.assign(server, { status: 'READY', tools: (started.tools || []).length, started: true });
        } catch (error) { server.error = errorText(error); }
      }));
    }
    report.tools.servers = queue.map(({ agentAccess, ...rest }) => rest);
    report.tools.ready = queue.filter(s => s.status === 'READY').length;
    report.tools.toolCount = queue.reduce((n, s) => n + (s.status === 'READY' ? s.tools : 0), 0);
    for (const s of queue.filter(s => s.error)) report.problems.push(`Tool server ${s.id} did not start: ${s.error}`);
  } catch (error) { report.problems.push(`Could not read the tools: ${errorText(error)}`); }
  if (report.tools.toolCount === 0) report.problems.push('No tools are active: agents cannot read files, run git or fetch pages.');

  // Providers: which answer right now.
  try { report.providers = (await call(fetchImpl, baseUrl, token, 'GET', '/api/aura/workbench/providers/scan')).providers || []; }
  catch (error) { report.problems.push(`Could not scan providers: ${errorText(error)}`); }

  // The planner the GUI chose, and whether it can answer.
  try {
    const state = await call(fetchImpl, baseUrl, token, 'GET', '/api/nova/planner');
    const scanned = id => report.providers.find(p => p.id === id);
    const option = id => (state.choices || []).find(c => c.provider === id);
    const describe = (provider, model, source) => {
      const seen = scanned(provider), opt = option(provider);
      // READY means observed, not inferred from a configured key. If the selected planner was not part of
      // the provider scan, activation must fail closed instead of treating "key exists" as reachability.
      const reachable = seen ? Boolean(seen.active) : false;
      return {
        provider,
        model,
        source,
        reachable,
        why: seen ? seen.state : opt ? (opt.usable ? 'NOT_PROBED' : opt.keyConfigured ? 'PAID_MODELS_OFF' : 'NO_KEY') : 'UNKNOWN_PROVIDER',
      };
    };
    if (state.choice) report.planner = describe(state.choice.provider, state.choice.model, state.choice.by === 'environment' ? 'environment' : 'GUI');
    else {
      const first = report.providers.find(p => p.active);
      report.planner = first ? describe(first.id, first.defaultModel, 'automatic') : { provider: null, model: null, source: 'automatic', reachable: false, why: 'NO_ACTIVE_PROVIDER' };
    }
    if (report.planner.reachable === false && report.planner.why !== 'NO_ACTIVE_PROVIDER') report.problems.push(`Nova's planner ${report.planner.provider || '(none)'} is not answering (${report.planner.why}). Choose another under Providers > Use.`);
  } catch (error) { report.problems.push(`Could not read the planner choice: ${errorText(error)}`); }
  if (report.providers.length && !report.providers.some(p => p.active)) report.problems.push('No model provider is answering. Paste an API key under Providers or start a local model (Ollama).');

  const workplaceReady = !requireWorkplace || (report.workplace.up === true && (lite
    ? report.workplace.state === 'READY'
    : report.workplace.state === 'RUNNING' && report.workplace.novaState === 'RUNNING'));
  const executorReady = !lite || report.executor.state === 'RUNNING';
  const supervisorReady = !requireSupervisor || (report.supervisor.up === true && report.supervisor.state === 'READY');
  report.ok = Boolean(
    report.runtime.up &&
    supervisorReady &&
    workplaceReady &&
    executorReady &&
    report.tools.toolCount > 0 &&
    report.planner?.reachable === true &&
    report.providers.some(p => p.active || false) &&
    report.problems.length === 0
  );
  return report;
}

const PROVIDER_TEXT = { ACTIVE: 'active', NO_KEY: 'no key', KEY_REJECTED: 'key rejected', UNREACHABLE: 'not answering' };
export function formatReport(r) {
  const out = [];
  out.push(`JACO ${r.ok ? 'is active' : 'is not fully active'}${r.runtime.version ? ` (runtime ${r.runtime.version})` : ''}`);
  if (!r.runtime.up) { out.push(...r.problems.map(p => `  ! ${p}`)); return out.join('\n'); }
  if (r.supervisor?.required) out.push('', `Supervisor: ${r.supervisor.up ? r.supervisor.state || 'UNKNOWN' : 'NOT ANSWERING'}`);
  if (r.workplace?.required) out.push('', `Workplace/Nova: ${r.workplace.up ? `${r.workplace.state || 'UNKNOWN'} / ${r.workplace.novaState || 'UNKNOWN'}` : 'NOT ANSWERING'}`);
  if (r.executor?.owner === 'lite-launcher') out.push('', `Aura durable executor: ${r.executor.state} (Lite launcher)`);
  out.push('', `Tools: ${r.tools.toolCount} in ${r.tools.ready} of ${r.tools.servers.length} servers`);
  for (const s of r.tools.servers) out.push(`  ${s.status === 'READY' ? 'ok ' : '-- '} ${s.id.padEnd(12)} ${s.status === 'READY' ? `${s.tools} tools${s.started ? ' (started now)' : ''}` : s.error ? `error: ${s.error}` : 'stopped'}`);
  out.push('', 'Models:');
  for (const p of r.providers) out.push(`  ${p.active ? 'ok ' : '-- '} ${String(p.id).padEnd(14)} ${p.active ? `${p.models} models${p.ms != null ? `, ${p.ms} ms` : ''}` : PROVIDER_TEXT[p.state] || p.state}`);
  if (r.planner) out.push('', `Nova plans with: ${r.planner.provider ? `${r.planner.provider} / ${r.planner.model || '?'}` : '(none)'} [${r.planner.source}] ${r.planner.reachable === true ? 'answering' : r.planner.reachable === false ? 'NOT ANSWERING' : 'key present, not probed'}`);
  if (r.problems.length) out.push('', 'To fix:', ...r.problems.map(p => `  ! ${p}`));
  return out.join('\n');
}
