// Nova's side of JACO's MCP host (operator 2026-10-03: JACO owns its tools; any LLM can drive them).
// The runtime runs the MCP servers; Nova lists the tools it may use for the planner and calls them
// through the mcp-call task. Each server's agent access (read, write or off) is set by the operator in
// the IDE; the runtime decides per tool (agentAllowed) and refuses anything else with a reason.
const SERVER = /^[a-z][a-z0-9-]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,80}$/;

export function validateMcpCall(task) {
  const d = task?.data || {};
  if (!SERVER.test(String(d.server || ''))) throw new Error('MCP_SERVER_INVALID');
  if (!TOOL.test(String(d.tool || ''))) throw new Error('MCP_TOOL_INVALID');
  if (d.arguments !== undefined && (typeof d.arguments !== 'object' || d.arguments === null || Array.isArray(d.arguments))) throw new Error('MCP_ARGUMENTS_INVALID');
  return { ...task, data: { server: d.server, tool: d.tool, arguments: d.arguments || {} } };
}

const auth = env => { const t = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || ''; return { Authorization: `Bearer ${t}`, 'x-gateway-token': t }; };

let catalogCache = { at: 0, value: null };
// Which tools a mission sees: read-only ones, plus changing ones when it may run mcp-write. A runtime
// that predates agent access sends no agentAllowed: then only read-only tools.
const usable = write => t => Boolean(t.readOnly ? (t.agentAllowed ?? true) : write && t.agentAllowed);
// Compact catalog for the planner prompt: the tools this mission may use, short descriptions, a tool
// that changes something marked [changes: mcp-write]. Servers are started
// once so their tools are known; a server that fails to start is listed with its error.
export async function mcpCatalog({ env = process.env, fetchImpl = fetch, runtimeUrl, now = Date.now(), write = false } = {}) {
  if (catalogCache.servers && now - catalogCache.at < 10 * 60_000) return catalogView(write);
  const base = runtimeUrl || env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
  const get = async () => (await (await fetchImpl(`${base}/api/mcp/tools`, { headers: auth(env), signal: AbortSignal.timeout(15_000) })).json()).servers || [];
  let servers = await get();
  const idle = servers.filter(s => !s.tools?.length && s.status !== 'FAILED');
  if (idle.length) {
    await Promise.allSettled(idle.map(s => fetchImpl(`${base}/api/mcp/start`, { method: 'POST', headers: { ...auth(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ server: s.id }), signal: AbortSignal.timeout(180_000) })));
    servers = await get();
  }
  // Notes the operator approved from JACO's own mistakes (agents/lib/skill-learning.mjs), per tool.
  let notes = {};
  try { notes = (await (await fetchImpl(`${base}/api/tool-notes`, { headers: auth(env), signal: AbortSignal.timeout(10_000) })).json()).notes || {}; } catch {}
  const taskNotes = Object.fromEntries(Object.keys(notes).filter(k => !k.includes('.')).map(k => [k, (notes[k] || []).map(n => n.note).join(' | ').slice(0, 300)]));
  catalogCache = { at: now, servers, notes, taskNotes, write };
  return catalogView(write);
}

function catalogView(write) {
  const { servers, notes } = catalogCache;
  catalogCache.write = write;
  const noteText = key => (notes[key] || []).map(n => n.note).join(' | ').slice(0, 300);
  return servers.map(s => ({
    server: s.id, name: s.name, role: s.role,
    tools: (s.tools || []).filter(usable(write)).map(t => {
      const note = noteText(`${s.id}.${t.name}`);
      return `${t.name}${argList(t.inputSchema)}${t.readOnly ? '' : ' [changes: mcp-write]'}: ${String(t.description).replace(/\s+/g, ' ').slice(0, 90)}${note ? ` [learned: ${note}]` : ''}`;
    }),
    ...(s.status === 'FAILED' ? { unavailable: true } : {}),
  })).filter(s => s.tools.length || s.unavailable);
}
// The usable tools of the last catalog with their input schemas, for native tool calling.
export function mcpCatalogTools({ write = catalogCache.write ?? false } = {}) {
  const { servers = [], notes = {} } = catalogCache;
  const noteText = key => (notes[key] || []).map(n => n.note).join(' | ').slice(0, 300);
  return servers.flatMap(s => (s.tools || []).filter(usable(write)).map(t => ({ server: s.id, name: t.name, description: String(t.description || ''), inputSchema: t.inputSchema, readOnly: Boolean(t.readOnly), note: noteText(`${s.id}.${t.name}`) })));
}
// Approved notes for Nova's own tasks (e.g. web-fetch), keyed by task type.
export function learnedTaskNotes() { return catalogCache.taskNotes || {}; }
// Argument names in the catalog (required ones without '?'): without them a planner guessed names
// (observed 2026-10-03: git_show called with 'commit' instead of 'revision', and without repo_path).
export function argList(schema) {
  const props = Object.keys(schema?.properties || {});
  if (!props.length) return '';
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return `(${props.slice(0, 8).map(p => required.has(p) ? p : `${p}?`).join(', ')}${props.length > 8 ? ', ...' : ''})`;
}
export function resetMcpCatalog() { catalogCache = { at: 0, servers: null, notes: {}, taskNotes: {}, write: false }; }

// Executes one mcp-call (mode 'read') or mcp-write (mode 'write'). The receipt carries a bounded text
// excerpt of the tool result.
export async function callMcpTool(data, { env = process.env, fetchImpl = fetch, runtimeUrl, mode = 'read' } = {}) {
  const base = runtimeUrl || env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
  try {
    const res = await fetchImpl(`${base}/api/mcp/call`, {
      method: 'POST', headers: { ...auth(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: data.server, tool: data.tool, arguments: data.arguments || {}, mode: mode === 'write' ? 'write' : 'read' }), signal: AbortSignal.timeout(180_000),
    });
    let decoded = true;
    const body = await res.json().catch(() => { decoded = false; return {}; });
    // HTTP 200 is only a transport acknowledgement, not successful MCP execution.
    // The standard MCP isError flag wins over a 200 / success=true wrapper.
    // A write may have changed external state before its error was returned.
    const toolError = body?.result?.isError === true;
    const acknowledged = decoded && res.ok && body?.success === true && !toolError;
    const outcomeUnknown = mode === 'write' &&
      ((res.status >= 500) || (res.ok && !acknowledged));
    if (!acknowledged) return { ok: false, verified: false,
      ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
      error: String(body?.error || (toolError ? 'MCP_TOOL_ERROR' : !decoded ? 'MCP_RESPONSE_UNREADABLE' : !res.ok ? `HTTP_${res.status}` : 'MCP_ACK_INVALID')).slice(0, 300),
      output: textOf(body?.result) };
    // A cut result says so before the text, so the planner never presents a partial list as complete
    // (observed 2026-10-03: a commit's file list taken from a cut git_show).
    const full = fullTextOf(body.result);
    const output = full.slice(0, MAX_OUTPUT);
    return { ok: true, verified: true, server: data.server, tool: data.tool, outputChars: full.length,
      ...(full.length > MAX_OUTPUT ? { truncated: true, note: `output cut at ${MAX_OUTPUT} of ${full.length} chars: do not present it as complete; narrow the call (e.g. a path or a smaller range)` } : {}),
      output };
  } catch (error) {
    return { ok: false, verified: false, ...(mode === 'write' ? { outcomeUnknown: true } : {}), error: String(error?.message || error).slice(0, 300) };
  }
}

// Stored on the receipt (a receipt may be 50 kB); the planner sees a digest of it (head plus key lines).
const MAX_OUTPUT = 30_000;
const fullTextOf = result => (result?.content || []).map(c => c?.type === 'text' ? c.text : `[${c?.type}]`).join('\n');
export const textOf = result => fullTextOf(result).slice(0, MAX_OUTPUT);
