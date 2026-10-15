// JACO Editor: an MCP server over the JACO IDE's own workbench (operator 2026-10-09: "build from the JACO
// editor instead of VS Code"). Claude Code, ChatGPT or any MCP client reads, edits and commits the project
// the JACO IDE has open, through the same endpoints the IDE uses (/api/aura/workbench/*), so every change
// shows up in the IDE and goes through its guards: workspace-root confinement, a content hash on every
// overwrite (a stale edit is refused, never merged silently), no binary or oversized files, and git
// actions limited to the IDE's own list (stage, commit, fetch, pull --ff-only, push, merge).
//
//   node tools/jaco-editor-mcp.mjs     stdio (newline-delimited JSON-RPC), talks to JACO_RUNTIME_URL
//
// There is deliberately no shell tool: the runtime keeps its terminal local-only. Work that needs a
// command goes to Nova with start_goal and is followed in the IDE (Bygg).
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { joinWorkplace, buildAgentCard } from '../../agents/lib/workplace-session.mjs';

export function createEditorServer({ env = process.env, fetchImpl = fetch, join = joinWorkplace, managed = true } = {}) {
let session = null, pinnedRoot = null, initialized = false, inbox = [], inboxSeq = 0, droppedThrough = 0;
const RUNTIME = String(env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const BASE = '/api/aura/workbench';

async function runtime(method, route, body) {
  const res = await fetchImpl(`${RUNTIME}${route}`, {
    method, headers: { 'content-type': 'application/json', ...(pinnedRoot && /\/(file|tree|files|git|start-goal)(?:[/?]|$)/.test(route) ? { 'x-jaco-project-root': pinnedRoot } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000),
  }).catch(error => { throw new Error(`JACO runtime unreachable at ${RUNTIME}: ${error?.message || error}`); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(typeof data.error === 'string' ? data.error : `RUNTIME_HTTP_${res.status}`);
  return data;
}
const q = value => encodeURIComponent(String(value ?? ''));
const need = (args, ...names) => { for (const n of names) if (typeof args?.[n] !== 'string' || !args[n]) throw new Error(`${n.toUpperCase()}_REQUIRED`); };
const text = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

const readFile = async path => runtime('GET', `${BASE}/file?path=${q(path)}`);

const TOOLS = [
  {
    name: 'project', readOnly: true,
    description: 'The project the JACO IDE has open: root folder, name, recent projects and whether it is a git repository.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => runtime('GET', `${BASE}/project`),
  },
  {
    name: 'open_project',
    description: 'Open another folder as the IDE\'s project (the IDE switches too).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async args => { need(args, 'path'); const result = await runtime('POST', `${BASE}/project`, { path: args.path }); pinnedRoot = result.root; return result; },
  },
  {
    name: 'list_dir', readOnly: true,
    description: 'List one directory of the project (empty path = project root).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    run: async args => runtime('GET', `${BASE}/tree?path=${q(args?.path)}`),
  },
  {
    name: 'list_files', readOnly: true,
    description: 'Every file path in the project that the IDE indexes. Use it to find files; use list_dir to browse.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await runtime('GET', `${BASE}/files`)).files,
  },
  {
    name: 'read_file', readOnly: true,
    description: 'Read a text file (max 512 KB). Returns content and `hash`; pass that hash back when you overwrite the file.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async args => { need(args, 'path'); const f = await readFile(args.path); return { path: f.path, hash: f.hash, size: f.size, language: f.language, content: f.content }; },
  },
  {
    name: 'write_file',
    description: 'Create a file, or replace one you have read. A new file needs no hash. Replacing needs expectedHash from read_file; if the file changed since (an edit in the IDE, another agent) the write is refused with WORKBENCH_FILE_CONFLICT and you must read again. For a small change prefer edit_file.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, expectedHash: { type: 'string' } }, required: ['path', 'content'] },
    run: async args => {
      need(args, 'path');
      if (typeof args.content !== 'string') throw new Error('CONTENT_REQUIRED');
      const saved = await runtime('PUT', `${BASE}/file`, { path: args.path, content: args.content, ...(args.expectedHash ? { expectedHash: args.expectedHash } : {}) });
      return { path: saved.path, hash: saved.hash, size: saved.size };
    },
  },
  {
    name: 'edit_file',
    description: 'Replace one exact piece of text in a file. `old` must occur exactly once (add surrounding lines to make it unique) unless replaceAll is true. The edit is applied against the hash it was read at, so a concurrent change is refused instead of overwritten.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['path', 'old', 'new'] },
    run: async args => {
      need(args, 'path', 'old');
      if (typeof args.new !== 'string') throw new Error('NEW_REQUIRED');
      if (args.old === args.new) throw new Error('EDIT_NOOP');
      const f = await readFile(args.path);
      const count = f.content.split(args.old).length - 1;
      if (count === 0) throw new Error('EDIT_OLD_NOT_FOUND');
      if (count > 1 && !args.replaceAll) throw new Error(`EDIT_OLD_NOT_UNIQUE:${count}`);
      // split/join replaces literally: `new` may contain "$&" and the like.
      const saved = await runtime('PUT', `${BASE}/file`, { path: args.path, content: f.content.split(args.old).join(args.new), expectedHash: f.hash });
      return { path: saved.path, hash: saved.hash, replaced: args.replaceAll ? count : 1 };
    },
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file inside the project. Needs the file\'s current hash (from read_file).',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, expectedHash: { type: 'string' } }, required: ['from', 'to', 'expectedHash'] },
    run: async args => { need(args, 'from', 'to', 'expectedHash'); return runtime('POST', `${BASE}/file/rename`, { from: args.from, to: args.to, expectedHash: args.expectedHash }); },
  },
  {
    name: 'delete_file',
    description: 'Delete a file in the project. Needs the file\'s current hash (from read_file).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, expectedHash: { type: 'string' } }, required: ['path', 'expectedHash'] },
    run: async args => { need(args, 'path', 'expectedHash'); return runtime('POST', `${BASE}/file/delete`, { path: args.path, expectedHash: args.expectedHash }); },
  },
  {
    name: 'git_status', readOnly: true,
    description: 'Branch, ahead/behind and changed files of the open project.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await runtime('GET', `${BASE}/git/status`)).git,
  },
  {
    name: 'git_diff', readOnly: true,
    description: 'Unstaged and staged diff for one path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async args => { need(args, 'path'); const { success, ...diff } = await runtime('GET', `${BASE}/git/diff?path=${q(args.path)}`); return diff; },
  },
  {
    name: 'git_action',
    description: 'One of: stage {path}, unstage {path}, stage-all, commit {message}, fetch, pull (fast-forward only), push, merge {branch}. The IDE refuses everything else (no force, no reset, no rebase).',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['stage', 'unstage', 'stage-all', 'commit', 'fetch', 'pull', 'push', 'merge'] }, path: { type: 'string' }, message: { type: 'string' }, branch: { type: 'string' } }, required: ['action'] },
    run: async args => { need(args, 'action'); const { success, ...rest } = await runtime('POST', `${BASE}/git/action`, args); return rest; },
  },
  {
    name: 'start_goal',
    description: 'Hand a goal to Nova (JACO\'s own agent) when the work needs commands, tests or a browser, which this server does not run. Returns the mission; follow it in the IDE (Bygg). Uses the configured model, so it counts against the IDE\'s budget.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
    run: async args => { need(args, 'goal'); const { success, ...rest } = await runtime('POST', `${BASE}/start-goal`, { goal: args.goal }); return rest; },
  },
];

// Session credentials never cross the MCP response boundary, including error strings.
const secrets = () => [env.JACO_WORKPLACE_TOKEN, env.JACO_DEVICE_KEY, session?.client?.sessionToken, session?.registration?.sessionToken].filter(Boolean);
const safe = value => {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|password|secret|authorization|api.?key/i.test(key)).map(([key, val]) => [key, safe(val)]));
  if (typeof value !== 'string') return value;
  let result = value.replace(/wps_[A-Za-z0-9_-]+/g, '[REDACTED]');
  for (const secret of secrets()) result = result.split(secret).join('[REDACTED]');
  return result;
};
const receive = events => {
  for (const event of events) {
    inbox.push({ inboxCursor: ++inboxSeq, event: safe(event) });
    if (inbox.length > 200) droppedThrough = inbox.shift().inboxCursor;
  }
};
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
const extra = (name, description, inputSchema, run, readOnly = true) => ({name, description, inputSchema, run, readOnly});
TOOLS.push(
  extra('team_status', 'Observed Workplace session and agents; credentials are excluded.', schema({}), async () => ({state:session?.state || 'DEGRADED_UNSYNCED', agentId:session?.client?.agentId, sessionId:session?.client?.sessionId, lastSyncAt:session?.lastSyncAt, projectRoot:pinnedRoot, agents: session?.client ? await session.client.agents() : [], inboxCursor:inboxSeq, droppedThrough})),
  extra('team_inbox', 'Read bounded live events after your inbox cursor. ACK by Workplace is transport progress, not agent consumption. Overflow is explicit.', schema({after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}}), async args => {
    await session?.syncNow();
    const after = Number(args.after || 0);
    const events = inbox.filter(e => e.inboxCursor > after).slice(0,Math.max(1,Math.min(200,Number(args.limit)||50)));
    return {events, nextCursor:events.at(-1)?.inboxCursor ?? after, latestCursor:inboxSeq, overflow:after < droppedThrough, droppedThrough};
  }),
  extra('team_post', 'Publish an operator-authorized team MESSAGE, FINDING or HANDOFF. No mission creation or permission changes.', schema({kind:{type:'string',enum:['MESSAGE','FINDING','HANDOFF']},body:{type:'string',maxLength:16000},targets:{type:'array',items:{type:'string'}},thread:{type:'string'},eventId:{type:'string'}}), async args => {
    need(args,'kind','body');
    if (!['MESSAGE','FINDING','HANDOFF'].includes(args.kind)) throw Error('TEAM_EVENT_KIND_DENIED');
    if (args.body.length>16000) throw Error('TEAM_BODY_TOO_LARGE');
    if (JSON.stringify(safe(args))!==JSON.stringify(args)) throw Error('TEAM_SECRET_DENIED');
    return session.client.post(args.kind,args.body,{targets:args.targets,thread:args.thread,eventId:args.eventId || randomUUID()});
  }, false),
  extra('team_claim', 'Acquire a canonical Workplace lease before shared editing.', schema({resource:{type:'string'},intent:{type:'string'},leaseSeconds:{type:'integer',minimum:1,maximum:900}}), async args => {need(args,'resource','intent'); return session.client.claim(args.resource,{intent:args.intent,leaseSeconds:Math.min(900,Math.max(1,Number(args.leaseSeconds)||900))});},false),
  extra('team_release', 'Release a Workplace claim owned by this session.', schema({claimId:{type:'string'}}), async args => {need(args,'claimId');return session.client.releaseClaim(args.claimId);},false),
  extra('mcp_servers', 'Observed MCP providers and advertised tools from JACO.', schema({}), async () => runtime('GET',`${BASE}/mcp`)),
  extra('local_tool_call', 'Call only an explicitly advertised read-only JACO MCP tool. Mutations and commands belong to Nova.', schema({providerId:{type:'string'},toolName:{type:'string'},arguments:{type:'object'}}), async args => {
    need(args,'providerId','toolName');
    const fabric = await runtime('GET',`${BASE}/mcp`);
    const provider = (fabric.providers || fabric.mcp?.providers || []).find(p=>p.id===args.providerId);
    const tool = provider?.tools?.find(t=>t.name===args.toolName);
    if (!tool || tool.readOnly!==true) throw Error('MCP_READ_ONLY_TOOL_REQUIRED');
    return runtime('POST',`${BASE}/mcp/call`,{providerId:args.providerId,toolName:args.toolName,arguments:args.arguments || {}});
  }),
  extra('devices', 'Observed JACO device registry; pairing and secrets are not exposed.', schema({}), async () => runtime('GET',`${BASE}/devices`)),
  extra('mission_status', 'Canonical mission board, observed results and evidence; no execution is started.', schema({}), async () => runtime('GET',`${BASE}/agent-board`)),
  extra('gameboard_status', 'Observed shared gameboard: numeric agent/tool identities, simulated vs verified plans, and current SEER availability. Read-only.', schema({}), async () => runtime('GET',`${BASE}/gameboard`)),
  extra('gameboard_simulate', 'Hypothetical strategy calculation on explicit caller-supplied metrics. Never runs tools or marks receipts verified.', schema({goalId:{type:'string'},missionId:{type:'string'},steps:{type:'array',items:{type:'object'}}}), async args => runtime('POST',`${BASE}/gameboard/simulate`,args)),
  extra('gameboard_events', 'Read durable mathematical proposals, observations and current revision.', schema({scope:{type:'string'}}), async args => runtime('GET',`${BASE}/gameboard/events?scope=${q(args.scope||'global')}`)),
  extra('gameboard_publish', 'Publish mathematical MOVE_PROPOSAL, HYPOTHESIS or OBSERVATION. All claims remain UNVERIFIED; does not execute a tool. Requires current revision and Workplace sync.', schema({eventId:{type:'string'},scope:{type:'string'},actorId:{type:'string'},expectedRevision:{type:'integer',minimum:0},kind:{type:'string',enum:['OBSERVATION','HYPOTHESIS','MOVE_PROPOSAL']},statement:{type:'string'},target:{type:'string'},evidenceRefs:{type:'array',items:{type:'string'}},metrics:{type:'object'}}), async args => {
    const actorId = managed ? session?.client?.agentId : args.actorId;
    if (!actorId) throw Error('GAMEBOARD_ATTESTED_ACTOR_REQUIRED');
    return runtime('POST',`${BASE}/gameboard/events`,{...args,actorId:String(actorId)});
  }, false),
);
async function initialize(info = {}) {
  if (initialized) return;
  if (managed && !session) {
    const name = String(info.name || 'Unknown MCP client').slice(0,100);
    const card = buildAgentCard({stableId:env.JACO_AGENT_STABLE_ID || `jaco-editor:${name}`,name,agentType:'coding',role:'coding-agent',description:'MCP client using JACO workbench; client name is self-reported, model unknown.',environment:'mcp',tools:TOOLS.map(t=>t.name),capabilities:{filesystem_read:true,filesystem_write:true,code_edit:true,git_read:true,git_write:true,terminal:false},constraints:['No shell; command execution delegated to Nova','Client identity self-reported; model unknown'],version:'1.1.0'});
    session = await join({card,env:{...env,JACO_WORKPLACE_URL:env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995'},onEvents:receive});
  }
  pinnedRoot = (await runtime('GET',`${BASE}/project`)).root;
  if (typeof pinnedRoot !== 'string' || !pinnedRoot) throw Error('WORKBENCH_PROJECT_ROOT_REQUIRED');
  initialized = true;
}
async function handle(msg) {
  if (msg?.id === undefined) return null;
  const reply = result => ({ jsonrpc:'2.0',id:msg.id,result });
  try {
    if (msg.method === 'initialize') {await initialize(msg.params?.clientInfo);return reply({protocolVersion:msg.params?.protocolVersion || '2025-06-18',capabilities:{tools:{}},serverInfo:{name:'jaco-editor',version:'1.1.0'}});}
    if (msg.method === 'tools/list') return reply({tools:TOOLS.map(({run,readOnly,...t})=>({...t,annotations:{readOnlyHint:Boolean(readOnly),destructiveHint:t.name==='delete_file'}}))});
    if (msg.method === 'tools/call') {
      const tool = TOOLS.find(t=>t.name===msg.params?.name);
      if (!tool) return {jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'unknown tool'}};
      if (managed) {
        if (!initialized) throw Error('MCP_INITIALIZE_REQUIRED');
        if (!tool.readOnly) {const synced = await session?.syncNow();if (!synced || session?.state!=='READY') throw Error('DEGRADED_UNSYNCED');}
      }
      const busy = managed && !tool.readOnly;
      if (busy) await session.setActivity('BUSY');
      try {return reply({content:[{type:'text',text:text(safe(await tool.run(msg.params?.arguments || {})))}]});}
      finally {if(busy) await session.setActivity('READY');}
    }
    if (msg.method==='ping') return reply({});
    return {jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'method not found'}};
  } catch(error) {return reply({isError:true,content:[{type:'text',text:String(safe(error?.message || error)).split('\n')[0].slice(0,300)}]});}
}
return {handle,TOOLS,close:async()=>session?.end(),get projectRoot(){return pinnedRoot;}};
}
// Legacy exports retain isolated editor-test compatibility. The CLI always uses the managed factory.
const legacy = createEditorServer({managed:false});
export const TOOLS = legacy.TOOLS;
export const handle = legacy.handle;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createEditorServer();
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');
  const input = readline.createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  input.on('line', line => { queue = queue.then(async () => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const out = await server.handle(msg);
    if (out) send(out);
  }); });
  input.on('close', () => {void queue.finally(()=>server.close());});
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{void server.close().finally(()=>process.exit(0));});
}
