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

// Snapshots and refreshes belong to their runtime endpoint, never a mission's
// write flag. Refresh publication is atomic; invalidated refreshes cannot repopulate it.
const catalogs=new Map(), inFlight=new Map(), startAttempts=new Map();
const CATALOG_TTL=15_000;
const runtimeBase=(runtimeUrl,env=process.env)=>(runtimeUrl||env.JACO_RUNTIME_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const readyServer=s=>s?.status==='READY'&&s.agentAccess!=='off';
const usable=write=>t=>Boolean(t.readOnly===true?(t.agentAllowed??true):write&&t.agentAllowed===true);
const empty={servers:[],notes:{},taskNotes:{}};
const snapshotFor=runtimeUrl=>catalogs.get(runtimeBase(runtimeUrl))||empty;
async function refreshCatalog(base,{env,fetchImpl,now,discoveryWaitMs,isCurrent}){
  const get=async()=>{
    const response=await fetchImpl(base+'/api/mcp/tools',{headers:auth(env),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('MCP_CATALOG_HTTP_'+response.status);
    const payload=await response.json();
    if(!Array.isArray(payload.servers)||payload.success===false)throw Error('MCP_CATALOG_INVALID');
    return payload.servers;
  };
  let servers=await get();
  if(!isCurrent())throw Error('MCP_CATALOG_REFRESH_INVALIDATED');
  const idle=servers.filter(s=>s.agentAccess!=='off'&&s.transport!=='http'&&['STOPPED','FAILED'].includes(s.status)&&!s.tools?.length&&now-(startAttempts.get(base+'|'+s.id)??-Infinity)>=60_000).slice(0,8);
  if(idle.length){
    const wait=Math.min(3000,Math.max(100,Number(discoveryWaitMs)||1500));
    const starts=idle.map(s=>{
      startAttempts.set(base+'|'+s.id,now);
      if(startAttempts.size>128)startAttempts.delete(startAttempts.keys().next().value);
      return Promise.resolve().then(()=>{if(!isCurrent())return null;return fetchImpl(base+'/api/mcp/start',{method:'POST',headers:{...auth(env),'Content-Type':'application/json'},body:JSON.stringify({server:s.id}),signal:AbortSignal.timeout(wait)});});
    });
    let timer;
    try{await Promise.race([Promise.allSettled(starts),new Promise(resolve=>{timer=setTimeout(resolve,wait);})]);}
    finally{clearTimeout(timer);}
    // Preserve the first observed snapshot if the second probe fails.
    if(!isCurrent())throw Error('MCP_CATALOG_REFRESH_INVALIDATED');
    try{servers=await get();}catch{}
  }
  if(!isCurrent())throw Error('MCP_CATALOG_REFRESH_INVALIDATED');
  let notes={};
  try{const response=await fetchImpl(base+'/api/tool-notes',{headers:auth(env),signal:AbortSignal.timeout(1000)});if(response.ok)notes=(await response.json()).notes||{};}catch{}
  const taskNotes=Object.fromEntries(Object.keys(notes).filter(k=>!k.includes('.')).map(k=>[k,(Array.isArray(notes[k])?notes[k]:[]).map(n=>n.note).join(' | ').slice(0,300)]));
  return {at:now,servers,notes,taskNotes};
}
export async function mcpCatalog({env=process.env,fetchImpl=fetch,runtimeUrl,now=Date.now(),write=false,discoveryWaitMs=1500}={}){
  const base=runtimeBase(runtimeUrl,env);
  const cached=catalogs.get(base);
  if(cached&&now-cached.at>=0&&now-cached.at<CATALOG_TTL)return catalogView(cached,write);
  let pending=inFlight.get(base);
  if(!pending){
    pending=refreshCatalog(base,{env,fetchImpl,now,discoveryWaitMs,isCurrent:()=>inFlight.get(base)===pending}).then(snapshot=>{
      if(inFlight.get(base)!==pending)throw Error('MCP_CATALOG_REFRESH_INVALIDATED');
      catalogs.set(base,snapshot);
      if(catalogs.size>16)catalogs.delete(catalogs.keys().next().value);
      return snapshot;
    }).catch(error=>{
      if(inFlight.get(base)===pending)catalogs.delete(base);
      throw error;
    }).finally(()=>{if(inFlight.get(base)===pending)inFlight.delete(base);});
    inFlight.set(base,pending);
  }
  return catalogView(await pending,write);
}
function noteText(notes,key){return (Array.isArray(notes[key])?notes[key]:[]).map(n=>n.note).join(' | ').slice(0,300);}
function catalogView({servers,notes},write){
  return servers.map(s=>({
    server:s.id,name:s.name,role:s.role,
    tools:(readyServer(s)?s.tools||[]:[]).filter(usable(write)).map(t=>{
      const note=noteText(notes,s.id+'.'+t.name);
      return t.name+argList(t.inputSchema)+(t.readOnly?'':' [changes: mcp-write]')+': '+String(t.description).replace(/\s+/g,' ').slice(0,90)+(note?' [learned: '+note+']':'');
    }),
    ...(!readyServer(s)&&s.agentAccess!=='off'?{unavailable:true}:{}),
  })).filter(s=>s.tools.length||s.unavailable);
}
export function mcpCatalogTools({write=false,runtimeUrl}={}){
  const {servers,notes}=snapshotFor(runtimeUrl);
  return servers.filter(readyServer).flatMap(s=>(s.tools||[]).filter(usable(write)).map(t=>({server:s.id,name:t.name,description:String(t.description||''),inputSchema:t.inputSchema,readOnly:t.readOnly===true,note:noteText(notes,s.id+'.'+t.name)})));
}
export function learnedTaskNotes({runtimeUrl}={}){return snapshotFor(runtimeUrl).taskNotes;}
// Argument names in the catalog (required ones without '?'): without them a planner guessed names
// (observed 2026-10-03: git_show called with 'commit' instead of 'revision', and without repo_path).
export function argList(schema) {
  const props = Object.keys(schema?.properties || {});
  if (!props.length) return '';
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return `(${props.slice(0, 8).map(p => required.has(p) ? p : `${p}?`).join(', ')}${props.length > 8 ? ', ...' : ''})`;
}
export function resetMcpCatalog({clearCooldowns=false,runtimeUrl}={}){
  if(runtimeUrl){const base=runtimeBase(runtimeUrl);catalogs.delete(base);inFlight.delete(base);}
  else{catalogs.clear();inFlight.clear();}
  if(clearCooldowns)startAttempts.clear();
}

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
    const acknowledged = decoded && res.ok && body?.success === true && !toolError && (Array.isArray(body?.result?.content)||Boolean(body?.result?.structuredContent && typeof body.result.structuredContent==='object')) && (!body.dispatchState||body.dispatchState==='ACKNOWLEDGED');
    const knownRefusal = decoded && body?.dispatchState === 'NOT_DISPATCHED' && !toolError && body?.success === false && !res.ok;
    const legacyAuthRefusal = decoded && [401,403].includes(res.status) && body?.dispatchState !== 'UNKNOWN' && !toolError;
    const outcomeUnknown = mode === 'write' && !acknowledged && !knownRefusal && !legacyAuthRefusal;
    if(!acknowledged&&/MCP_(?:SERVER|SESSION|TOOL_UNKNOWN)/.test(String(body?.error||'')))resetMcpCatalog({runtimeUrl:base});
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
const fullTextOf = result => Array.isArray(result?.content) && result.content.length ? result.content.map(c => c?.type === 'text' ? c.text : `[${c?.type}]`).join('\n') : result?.structuredContent ? JSON.stringify(result.structuredContent) : '';
export const textOf = result => fullTextOf(result).slice(0, MAX_OUTPUT);
