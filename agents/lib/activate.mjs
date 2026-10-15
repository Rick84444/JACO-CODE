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

export async function runtimeUp({ baseUrl, fetchImpl = fetch } = {}) {
  try { return (await call(fetchImpl, baseUrl, '', 'GET', '/api/runtime/identity', null, 4000)).version || true; }
  catch { return false; }
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
  requireWorkplace = process.env.JACO_WORKPLACE_REQUIRED !== '0',
  requireSupervisor = Boolean(process.env.TERMUX_VERSION) || /com\.termux/.test(process.env.PREFIX || ''),
} = {}) {
  const report = {
    schema: 'jaco.activation/v2',
    at: new Date().toISOString(),
    runtime: { up: false, version: null },
    workplace: { required: requireWorkplace, up: false, state: null, novaState: null },
    supervisor: { required: requireSupervisor, up: null, state: null },
    tools: { servers: [], ready: 0, toolCount: 0 },
    providers: [],
    planner: null,
    problems: [],
    ok: false,
  };
  const version = await runtimeUp({ baseUrl, fetchImpl });
  if (!version) { report.problems.push('JACO-runtime svarar inte. Starta stacken med: jaco activate'); return report; }
  report.runtime = { up: true, version: version === true ? null : version };

  // On Termux, functional HTTP health is not enough: Sentinel/jacoctl owns the canonical runit tree.
  // A stray/orphan Core must never be allowed to make the product report READY.
  if (requireSupervisor) {
    try {
      const sentinel = await call(fetchImpl, sentinelUrl.replace(/\/+$/, ''), '', 'GET', '/api/system/status', null, 5000);
      const state = String(sentinel?.status?.state || sentinel?.status?.supervisor || 'UNKNOWN');
      report.supervisor = { required: true, up: true, state };
      if (state !== 'READY') report.problems.push(`Kanonisk supervisor är inte READY (${state}).`);
    } catch (error) {
      report.supervisor = { required: true, up: false, state: 'UNAVAILABLE' };
      report.problems.push(`Sentinel/supervisor svarar inte: ${errorText(error)}`);
    }
  } else {
    report.supervisor = { required: false, up: null, state: 'NOT_REQUIRED' };
  }

  // Durable execution truth: Core alone is not JACO READY. Workplace must be reachable and Durable Nova
  // must be RUNNING when Workplace is required, otherwise missions cannot continue after the chat returns.
  if (requireWorkplace) {
    try {
      const health = await call(fetchImpl, workplaceUrl.replace(/\/+$/, ''), '', 'GET', '/health', null, 4000);
      const supervised = health?.supervisedAgents || {};
      report.workplace = {
        required: true,
        up: true,
        state: supervised.state || health?.status || null,
        novaState: supervised.nova?.state || null,
      };
      if (supervised.state !== 'RUNNING' || supervised.nova?.state !== 'RUNNING') {
        report.problems.push(`Workplace/Durable Nova är inte RUNNING (workplace=${supervised.state || 'UNKNOWN'}, nova=${supervised.nova?.state || 'UNKNOWN'}).`);
      }
    } catch (error) {
      report.workplace = { required: true, up: false, state: null, novaState: null };
      report.problems.push(`Workplace svarar inte: ${errorText(error)}`);
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
    for (const s of queue.filter(s => s.error)) report.problems.push(`Verktygsservern ${s.id} startade inte: ${s.error}`);
  } catch (error) { report.problems.push(`Kunde inte läsa verktygen: ${errorText(error)}`); }
  if (report.tools.toolCount === 0) report.problems.push('Inga verktyg är aktiva: agenter kan inte läsa filer, köra git eller hämta sidor.');

  // Providers: which answer right now.
  try { report.providers = (await call(fetchImpl, baseUrl, token, 'GET', '/api/aura/workbench/providers/scan')).providers || []; }
  catch (error) { report.problems.push(`Kunde inte avsöka providers: ${errorText(error)}`); }

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
    if (state.choice) report.planner = describe(state.choice.provider, state.choice.model, state.choice.by === 'environment' ? 'miljö' : 'GUI');
    else {
      const first = report.providers.find(p => p.active);
      report.planner = first ? describe(first.id, first.defaultModel, 'automatiskt') : { provider: null, model: null, source: 'automatiskt', reachable: false, why: 'NO_ACTIVE_PROVIDER' };
    }
    if (report.planner.reachable === false && report.planner.why !== 'NO_ACTIVE_PROVIDER') report.problems.push(`Novas planerare ${report.planner.provider || '(ingen)'} svarar inte (${report.planner.why}). Välj en annan under Providers > Använd.`);
  } catch (error) { report.problems.push(`Kunde inte läsa planeringsvalet: ${errorText(error)}`); }
  if (report.providers.length && !report.providers.some(p => p.active)) report.problems.push('Ingen modell-provider svarar. Klistra in en API-nyckel under Providers eller starta en lokal modell (Ollama).');

  const workplaceReady = !requireWorkplace || (report.workplace.up === true && report.workplace.state === 'RUNNING' && report.workplace.novaState === 'RUNNING');
  const supervisorReady = !requireSupervisor || (report.supervisor.up === true && report.supervisor.state === 'READY');
  report.ok = Boolean(
    report.runtime.up &&
    supervisorReady &&
    workplaceReady &&
    report.tools.toolCount > 0 &&
    report.planner?.reachable === true &&
    report.providers.some(p => p.active || false) &&
    report.problems.length === 0
  );
  return report;
}

const PROVIDER_TEXT = { ACTIVE: 'aktiv', NO_KEY: 'ingen nyckel', KEY_REJECTED: 'nyckeln nekas', UNREACHABLE: 'svarar inte' };
export function formatReport(r) {
  const out = [];
  out.push(`JACO ${r.ok ? 'är aktivt' : 'är inte helt aktivt'}${r.runtime.version ? ` (runtime ${r.runtime.version})` : ''}`);
  if (!r.runtime.up) { out.push(...r.problems.map(p => `  ! ${p}`)); return out.join('\n'); }
  if (r.supervisor?.required) out.push('', `Supervisor: ${r.supervisor.up ? r.supervisor.state || 'UNKNOWN' : 'SVARAR INTE'}`);
  if (r.workplace?.required) out.push('', `Workplace/Nova: ${r.workplace.up ? `${r.workplace.state || 'UNKNOWN'} / ${r.workplace.novaState || 'UNKNOWN'}` : 'SVARAR INTE'}`);
  out.push('', `Verktyg: ${r.tools.toolCount} i ${r.tools.ready} av ${r.tools.servers.length} servrar`);
  for (const s of r.tools.servers) out.push(`  ${s.status === 'READY' ? 'ok ' : '-- '} ${s.id.padEnd(12)} ${s.status === 'READY' ? `${s.tools} verktyg${s.started ? ' (startades nu)' : ''}` : s.error ? `fel: ${s.error}` : 'stoppad'}`);
  out.push('', 'Modeller:');
  for (const p of r.providers) out.push(`  ${p.active ? 'ok ' : '-- '} ${String(p.id).padEnd(14)} ${p.active ? `${p.models} modeller${p.ms != null ? `, ${p.ms} ms` : ''}` : PROVIDER_TEXT[p.state] || p.state}`);
  if (r.planner) out.push('', `Nova planerar med: ${r.planner.provider ? `${r.planner.provider} / ${r.planner.model || '?'}` : '(ingen)'} [${r.planner.source}] ${r.planner.reachable === true ? 'svarar' : r.planner.reachable === false ? 'SVARAR INTE' : 'nyckel finns, ej provad'}`);
  if (r.problems.length) out.push('', 'Att åtgärda:', ...r.problems.map(p => `  ! ${p}`));
  return out.join('\n');
}
