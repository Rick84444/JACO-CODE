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

let catalogCache = { at: 0, servers: null, notes: {}, taskNotes: {}, write: false, base: null };
let catalogGeneration=0;
const startAttempts=new Map();
const CATALOG_TTL=15_000;
const readyServer=s=>s?.status==='READY'&&s.agentAccess!=='off';
// Which tools a mission sees: read-only ones, plus changing ones when it may run mcp-write. A runtime
// that predates agent access sends no agentAllowed: then only read-only tools.
const usable = write => t => Boolean(t.readOnly ? (t.agentAllowed ?? true) : write && t.agentAllowed);
// Compact catalog for the planner prompt: the tools this mission may use, short descriptions, a tool
// that changes something marked [changes: mcp-write]. Servers are started
// once so their tools are known; a server that fails to start is listed with its error.
export async function mcpCatalog({ env = process.env, fetchImpl = fetch, runtimeUrl, now = Date.now(), write = false, discoveryWaitMs = 1500 } = {}) {
  const base = (runtimeUrl || env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/$/,'');
  if (catalogCache.base===base&&catalogCache.servers&&now-catalogCache.at>=0&&now-catalogCache.at<CATALOG_TTL) return catalogView(write);
  const generation=++catalogGeneration;
  // A failed refresh must never advertise the previous endpoint's or
  // previous operator configuration's tools as observed ready.
  catalogCache={at:now,base,servers:null,notes:{},taskNotes:{},write};
  const get = async () => {
    const response=await fetchImpl(`${base}/api/mcp/tools`,{headers:auth(env),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error(`MCP_CATALOG_HTTP_${response.status}`);
    const payload=await response.json();
    if(!Array.isArray(payload.servers)||payload.success===false)throw Error('MCP_CATALOG_INVALID');
    return payload.servers;
  };
  let servers=await get();
  const idle=servers.filter(s=>s.agentAccess!=='off'&&s.transport!=='http'&&['STOPPED','FAILED'].includes(s.status)&&!s.tools?.length&&now-(startAttempts.get(base+'|'+s.id)??-Infinity)>=60_000).slice(0,8);
  if(idle.length){
    const wait=Math.min(3000,Math.max(100,Number(discoveryWaitMs)||1500));
    const starts=idle.map(s=>{
      startAttempts.set(base+'|'+s.id,now);
      if(startAttempts.size>128)startAttempts.delete(startAttempts.keys().next().value);
      return fetchImpl(`${base}/api/mcp/start`,{method:'POST',headers:{...auth(env),'Content-Type':'application/json'},body:JSON.stringify({server:s.id}),signal:AbortSignal.timeout(wait)});
    });
    let timer;
    try {await Promise.race([Promise.allSettled(starts),new Promise(resolve=>{timer=setTimeout(resolve,wait);})]);}
    finally {clearTimeout(timer);}
    // A failed follow-up does not make verified projections of the first
    // snapshot disappear; never infer that a requested start succeeded.
    try{servers=await get();}catch{}
  }
  let notes={};
  try {const response=await fetchImpl(`${base}/api/tool-notes`,{headers:auth(env),signal:AbortSignal.timeout(1000)});if(response.ok)notes=(await response.json()).notes||{};}catch{}
  const taskNotes=Object.fromEntries(Object.keys(notes).filter(k=>!k.includes('.')).map(k=>[k,(notes[k]||[]).map(n=>n.note).join(' | ').slice(0,300)]));
  if(generation!==catalogGeneration)return catalogView(write);
  catalogCache={at:now,base,servers,notes,taskNotes,write};
  return catalogView(write);
}

function catalogView(write) {
  const { servers = [], notes = {} } = catalogCache;
  if(!servers)return [];
  catalogCache.write = write;
  const noteText = key => (notes[key] || []).map(n => n.note).join(' | ').slice(0, 300);
  return servers.map(s => ({
    server: s.id, name: s.name, role: s.role,
    tools: (readyServer(s)?s.tools||[]:[]).filter(usable(write)).map(t => {
      const note = noteText(`${s.id}.${t.name}`);
      return `${t.name}${argList(t.inputSchema)}${t.readOnly ? '' : ' [changes: mcp-write]'}: ${String(t.description).replace(/\s+/g, ' ').slice(0, 90)}${note ? ` [learned: ${note}]` : ''}`;
    }),
    ...(!readyServer(s)&&s.agentAccess!=='off' ? { unavailable: true } : {}),
  })).filter(s => s.tools.length || s.unavailable);
}
// The usable tools of the last catalog with their input schemas, for native tool calling.
export function mcpCatalogTools({ write = catalogCache.write ?? false } = {}) {
  const { servers = [], notes = {} } = catalogCache;
  const noteText = key => (notes[key] || []).map(n => n.note).join(' | ').slice(0, 300);
  return (servers||[]).filter(readyServer).flatMap(s => (s.tools || []).filter(usable(write)).map(t => ({ server: s.id, name: t.name, description: String(t.description || ''), inputSchema: t.inputSchema, readOnly: Boolean(t.readOnly), note: noteText(`${s.id}.${t.name}`) })));
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
export function resetMcpCatalog() { catalogGeneration++; startAttempts.clear(); catalogCache = { at: 0, servers: null, notes: {}, taskNotes: {}, write: false, base:null }; }

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
    const acknowledged = decoded && res.ok && body?.success === true && !toolError && Array.isArray(body?.result?.content) && (!body.dispatchState||body.dispatchState==='ACKNOWLEDGED');
    const knownRefusal = decoded && body?.dispatchState === 'NOT_DISPATCHED' && !toolError && body?.success === false && !res.ok;
    const legacyAuthRefusal = decoded && [401,403].includes(res.status) && body?.dispatchState !== 'UNKNOWN' && !toolError;
    const outcomeUnknown = mode === 'write' && !acknowledged && !knownRefusal && !legacyAuthRefusal;
    if(!acknowledged&&/MCP_(?:SERVER|SESSION|TOOL_UNKNOWN)/.test(String(body?.error||'')))resetMcpCatalog();
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
