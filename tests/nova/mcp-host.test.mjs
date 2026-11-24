// Operator 2026-10-03: JACO hosts its own MCP servers and any LLM can drive them through Nova.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { StdioMcpHost, loadServerConfig, isReadOnlyTool } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
const { validateMcpCall, mcpCatalog, callMcpTool, resetMcpCatalog } = await import('../../agents/lib/mcp-tools.mjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-mcp-'));
// A minimal real stdio MCP server: newline-delimited JSON-RPC, one read-only and one mutating tool.
const serverFile = path.join(dir, 'fake-server.mjs');
fs.writeFileSync(serverFile, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'write', description: 'Writes something', inputSchema: { type: 'object' } },
    { name: 'crash', description: 'Exits', inputSchema: { type: 'object' } } ] } });
  else if (m.method === 'tools/call' && m.params.name === 'crash') process.exit(3);
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: m.params.name + ':' + (m.params.arguments.text || '') }] } });
});`);
const configFile = path.join(dir, 'servers.json');
fs.writeFileSync(configFile, JSON.stringify({ servers: { fake: { name: 'Fake', command: process.execPath, args: [serverFile] }, fetch: { enabled: false }, 'Bad Id': { command: 'x', args: [] } } }));

test('config: built-in servers plus the file; disabled and malformed entries are dropped', () => {
  const s = loadServerConfig({ configFile, repoRoot: dir, runtimeRoot: dir });
  assert.deepEqual(Object.keys(s).sort(), ['browser', 'cloudflare', 'connect', 'fake', 'filesystem', 'frantic', 'git', 'jaco', 'jobbi', 'repo', 'shell']);
  assert.equal(s.jobbi.agentAccess, 'read');
  assert.equal(s.jobbi.transport, 'http');
  assert.equal(s.frantic.agentAccess, 'read');
  assert.equal(s.frantic.url, 'https://api.gofrantic.com/mcp/discovery');
  assert.deepEqual(s.filesystem.args.slice(-1), [dir], 'filesystem is confined to the repo root');
});

test('a stdio server starts on first use, lists tools, runs calls, and restarts after it exits', async () => {
  const host = new StdioMcpHost({ configFile, repoRoot: dir, runtimeRoot: dir });
  try {
    assert.equal(host.status().find(x => x.id === 'fake').status, 'STOPPED', 'nothing starts until used');
    const tools = await host.start('fake');
    assert.deepEqual(tools.map(t => [t.name, t.readOnly]), [['echo', true], ['write', false], ['crash', false]]);
    assert.equal((await host.call('fake', 'echo', { text: 'hi' })).content[0].text, 'echo:hi');
    assert.equal((await host.call('fake','fake.echo',{text:'alias'},{actor:'agent',readOnly:true})).content[0].text,'echo:alias');
    await assert.rejects(host.call('fake','other.echo',{}, {actor:'agent',readOnly:true}),/MCP_TOOL_UNKNOWN/);
    await assert.rejects(host.call('fake','fake.write',{}, {actor:'agent',readOnly:true}),/MCP_TOOL_NOT_READ_ONLY/);
    await assert.rejects(host.call('fake', 'write', {}, { readOnly: true }), /MCP_TOOL_NOT_READ_ONLY:fake.write/, 'agents cannot run mutating tools');
    assert.equal((await host.call('fake', 'write', {})).content[0].text, 'write:', 'the operator click can');
    await assert.rejects(host.call('fake', 'nope', {}), /MCP_TOOL_UNKNOWN/);
    await assert.rejects(host.call('fake', 'crash', {}), /MCP_SERVER_EXITED|MCP_TIMEOUT/);
    assert.equal((await host.call('fake', 'echo', { text: 'back' })).content[0].text, 'echo:back', 'restarted on next use');
    await assert.rejects(host.start('missing'), /MCP_SERVER_UNKNOWN/);
  } finally { host.stopAll(); }
  assert.equal(isReadOnlyTool('fetch', { name: 'fetch' }), true, 'fetch only reads but has no annotation');
});

test('a missing command fails at once, and a stopped process cannot disturb its replacement', async () => {
  const cfg = path.join(dir, 'servers2.json');
  fs.writeFileSync(cfg, JSON.stringify({ servers: { fake: { command: process.execPath, args: [serverFile] }, nocmd: { command: 'jaco-no-such-command-xyz', args: [] } } }));
  const host = new StdioMcpHost({ configFile: cfg, repoRoot: dir, runtimeRoot: dir });
  try {
    const t0 = Date.now();
    await assert.rejects(host.start('nocmd'), /MCP_SERVER_SPAWN_FAILED:nocmd/);
    assert.ok(Date.now() - t0 < 10_000, 'no 120 s initialize timeout');
    assert.equal(host.status().find(s => s.id === 'nocmd').status, 'FAILED');
    await host.start('fake');
    const c = host.clients.get('fake');
    c.stop();
    await host.start('fake');
    await new Promise(r => setTimeout(r, 500)); // the old process's exit event arrives now
    assert.equal(host.status().find(s => s.id === 'fake').status, 'READY');
    assert.equal((await host.call('fake', 'echo', { text: 'still' })).content[0].text, 'echo:still');
  } finally { host.stopAll(); }
});

test('Nova: mcp-call is validated, the catalog lists only read-only tools, and calls return bounded text', async () => {
  assert.deepEqual(validateMcpCall({ type: 'mcp-call', data: { server: 'git', tool: 'git_log' } }).data, { server: 'git', tool: 'git_log', arguments: {} });
  for (const bad of [{ server: 'Git!', tool: 'x' }, { server: 'git', tool: 'a b' }, { server: 'git', tool: 'x', arguments: [] }]) {
    assert.throws(() => validateMcpCall({ type: 'mcp-call', data: bad }), /MCP_/);
  }
  resetMcpCatalog({clearCooldowns:true});
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace('http://rt', '')}`);
    if (url.endsWith('/api/mcp/tools')) {
      const started = calls.some(c => c.startsWith('POST /api/mcp/start'));
      return new Response(JSON.stringify({ servers: [
        { id: 'git', name: 'Git', role: 'r', status: started ? 'READY' : 'STOPPED', tools: started ? [{ name: 'git_log', description: 'Log', readOnly: true, inputSchema: { type: 'object', properties: { repo_path: {}, max_count: {} }, required: ['repo_path'] } }, { name: 'git_commit', description: 'Commit', readOnly: false }] : [] },
        { id: 'broken', name: 'B', role: 'r', status: 'FAILED', tools: [] }] }));
    }
    if (url.endsWith('/api/mcp/start')) return new Response('{"success":true}');
    if (url.endsWith('/api/mcp/call')) return new Response(JSON.stringify({ success: true, result: { content: [{ type: 'text', text: 'x'.repeat(31000) }] } }));
    throw new Error(url);
  };
  const cat = await mcpCatalog({ env: {}, fetchImpl, runtimeUrl: 'http://rt' });
  assert.deepEqual(cat, [{ server: 'git', name: 'Git', role: 'r', tools: ['git_log(repo_path, max_count?): Log'] },{ server: 'broken', name: 'B', role: 'r', tools: [], unavailable: true }]);
  assert.ok(calls.includes('POST /api/mcp/start'), 'idle servers are started so their tools are known');
  const r = await callMcpTool({ server: 'git', tool: 'git_log', arguments: {} }, { env: {}, fetchImpl, runtimeUrl: 'http://rt' });
  assert.deepEqual([r.ok, r.verified, r.output.length, r.outputChars, r.truncated], [true, true, 30000, 31000, true]);
  assert.ok(Object.keys(r).indexOf('note') < Object.keys(r).indexOf('output'), 'the cut is announced before the text');
  const refused = await callMcpTool({ server: 'git', tool: 'git_commit' }, { env: {}, runtimeUrl: 'http://rt', fetchImpl: async () => new Response(JSON.stringify({ success: false, error: 'MCP_TOOL_NOT_READ_ONLY:git.git_commit' }), { status: 409 }) });
  assert.deepEqual([refused.ok, refused.error], [false, 'MCP_TOOL_NOT_READ_ONLY:git.git_commit']);
});

test('a batched plan is cut before an invalid or changing follow-up step; an invalid first step is rejected', async () => {
  const { assertPlanTaskAllowed } = await import('../../agents/hands-off-agent.mjs');
  const mission = { goal: 'x', allowedTasks: ['mcp-call', 'web-fetch', 'browser-click'] };
  const ok = { type: 'mcp-call', data: { server: 'git', tool: 'git_log' } };
  const p1 = { tasks: [ok, { type: 'web-fetch', data: { url: 'https://a.test' } }, { type: 'mcp-call', data: { server: 'Bad!', tool: 'x' } }, ok] };
  assertPlanTaskAllowed(p1, mission);
  assert.equal(p1.tasks.length, 2);
  const p2 = { tasks: [ok, { type: 'browser-click', data: { name: 'Buy' } }] };
  assertPlanTaskAllowed(p2, mission);
  assert.equal(p2.tasks.length, 1, 'a click cannot ride along in a batch');
  assert.throws(() => assertPlanTaskAllowed({ tasks: [{ type: 'shell', data: { command: 'x' } }, ok] }, mission), /PLAN_TASK_NOT_ALLOWED:shell/);
});

test('JACO\'s repo server lists a commit\'s files without its diff and refuses option-like revisions', async () => {
  const host = new StdioMcpHost({ configFile: path.join(dir, 'none.json'), repoRoot: path.resolve('.'), runtimeRoot: path.resolve('runtime') });
  try {
    const tools = await host.start('repo');
    assert.deepEqual(tools.map(t => [t.name, t.readOnly]), [['commit_files', true], ['recent_commits', true]]);
    const text = (await host.call('repo', 'commit_files', { revision: 'HEAD' }, { readOnly: true })).content[0].text;
    assert.match(text, /^commit [0-9a-f]{40}\ndate .+\nsubject .+\nfiles \d+\n/);
    const bad = await host.call('repo', 'commit_files', { revision: '--output=/tmp/x' }, { readOnly: true });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /invalid revision/);
  } finally { host.stopAll(); }
});

// Operator 2026-10-09: agents get more than read-only tools, set per server in the IDE, with feedback
// on every call; servers are added from the IDE; a logo per server.
test('agent access per server: read, write and off; denied tools and protected paths always refused', async () => {
  const cfg = path.join(dir, 'servers-access.json');
  fs.writeFileSync(cfg, JSON.stringify({ servers: { fake: { command: process.execPath, args: [serverFile], agentAccess: 'write', deny: ['crash'] } } }));
  const host = new StdioMcpHost({ configFile: cfg, repoRoot: dir, runtimeRoot: dir });
  try {
    await host.start('fake');
    assert.equal((await host.call('fake', 'write', { text: 'x' }, { actor: 'agent' })).content[0].text, 'write:x', 'write access runs a changing tool');
    await assert.rejects(host.call('fake', 'write', {}, { readOnly: true }), /MCP_TOOL_NOT_READ_ONLY:fake.write/, 'an mcp-call (read mode) still refuses it');
    await assert.rejects(host.call('fake', 'crash', {}, { actor: 'agent' }), /MCP_TOOL_DENIED:fake.crash/);
    for (const p of ['.env', 'a/.env.local', '.git/config', 'node_modules/x/index.js', 'keys/secret.txt', '.jaco/state/capabilities.json']) {
      await assert.rejects(host.call('fake', 'write', { path: p }, { actor: 'agent' }), /MCP_PROTECTED_PATH/, p);
    }
    assert.equal((await host.call('fake', 'write', { path: 'src/a.js', content: 'mentions a secret' }, { actor: 'agent' })).content[0].text, 'write:', 'content may mention secrets');
    host.setAccess('fake', { agentAccess: 'off' });
    await assert.rejects(host.call('fake', 'echo', {}, { actor: 'agent' }), /MCP_AGENT_ACCESS_OFF/, 'off refuses even reading');
    assert.equal((await host.call('fake', 'write', {})).content[0].text, 'write:', 'the operator click is not limited by agent access');
    const s = host.status().find(x => x.id === 'fake');
    assert.equal(s.agentAccess, 'off');
    assert.deepEqual(s.tools.map(t => t.agentAllowed), [false, false, false]);
    assert.deepEqual([s.stats.calls, s.stats.refused, s.stats.lastCall.actor], [3, 9, 'operator'], 'all calls and all nine refusals, including the GUI policy file, are counted');
    assert.match(host.recentCalls(2)[1].error, /^MCP_AGENT_ACCESS_OFF:fake.echo/, 'a refusal is recorded with its reason');
  } finally { host.stopAll(); }
});

test('servers are added, changed and removed from the IDE; secrets stay env references; built-ins are switched off', () => {
  const cfg = path.join(dir, 'servers-managed.json');
  const host = new StdioMcpHost({ configFile: cfg, repoRoot: dir, runtimeRoot: dir });
  const added = host.saveServer('memory', { name: 'Memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], icon: 'mcp', agentAccess: 'write', env: { API_KEY: '${MEMORY_KEY}' } });
  assert.deepEqual([added.id, added.transport, added.agentAccess, added.icon, added.builtIn, added.status], ['memory', 'stdio', 'write', 'mcp', false, 'STOPPED']);
  assert.throws(() => host.saveServer('leak', { command: 'x', args: [], env: { API_KEY: 'sk-live-123' } }), /MCP_SECRET_MUST_BE_ENV_REFERENCE/);
  assert.throws(() => host.saveServer('Bad Id', { command: 'x', args: [] }), /MCP_SERVER_ID_INVALID/);
  assert.throws(() => host.saveServer('web', { transport: 'http', url: 'http://plain.test/mcp' }), /MCP_HTTPS_URL_REQUIRED/);
  assert.equal(host.saveServer('web', { transport: 'http', url: 'https://example.test/mcp', icon: 'github' }).icon, 'github');
  assert.equal(JSON.parse(fs.readFileSync(cfg, 'utf8')).servers.memory.env.API_KEY, '${MEMORY_KEY}');
  assert.equal(host.setAccess('git', { agentAccess: 'read' }).agentAccess, 'read', 'a built-in server takes an access override');
  assert.deepEqual(host.status().find(x => x.id === 'git').deny, ['git_reset', 'git_checkout', 'git_init'], 'its default deny list stays');
  assert.deepEqual(host.removeServer('memory'), { id: 'memory', removed: true, disabled: false });
  assert.deepEqual(host.removeServer('git'), { id: 'git', removed: false, disabled: true });
  assert.equal(host.status().some(x => x.id === 'git' || x.id === 'memory'), false);
  assert.throws(() => host.removeServer('nothing'), /MCP_SERVER_UNKNOWN/);
  assert.deepEqual(['jaco', 'filesystem', 'cloudflare'].map(id => host.status().find(x => x.id === id)?.icon), ['jaco', 'mcp', 'cloudflare'], 'built-ins carry their logo');
});

test('a remote server stays read-only for agents even when configured for writing', async () => {
  const { agentRefusal } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
  assert.equal(agentRefusal({ transport: 'http', agentAccess: 'write', deny: [] }, { name: 'post', readOnly: false }), 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY');
  assert.equal(agentRefusal({ transport: 'http', agentAccess: 'write', deny: [] }, { name: 'get', readOnly: true }), null);
});

test('a server that exited between calls is started again and the call succeeds', async () => {
  const host = new StdioMcpHost({ configFile, repoRoot: dir, runtimeRoot: dir });
  try {
    await host.start('fake');
    host.clients.get('fake').proc.kill();
    await new Promise(r => setTimeout(r, 300));
    const stopped=host.status().find(s=>s.id==='fake');
    assert.notEqual(stopped.status,'READY');
    assert.deepEqual(stopped.tools,[],'old descriptors must not look ready');
    assert.equal((await host.call('fake', 'echo', { text: 'again' })).content[0].text, 'echo:again');
  } finally { host.stopAll(); }
});

test('Nova: changing tools appear only for missions with mcp-write and run as mcp-write steps', async () => {
  const { plannerTools, planFromToolCalls } = await import('../../agents/lib/native-tools.mjs');
  const { mcpCatalogTools } = await import('../../agents/lib/mcp-tools.mjs');
  resetMcpCatalog({clearCooldowns:true});
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/api/mcp/tools')) return new Response(JSON.stringify({ servers: [{ id: 'filesystem', name: 'Files', role: 'r', status: 'READY', tools: [
      { name: 'read_file', description: 'Read', readOnly: true, agentAllowed: true, inputSchema: { type: 'object', properties: { path: {} } } },
      { name: 'write_file', description: 'Write', readOnly: false, agentAllowed: true, inputSchema: { type: 'object', properties: { path: {}, content: {} } } },
      { name: 'move_file', description: 'Move', readOnly: false, agentAllowed: false, inputSchema: { type: 'object' } }] }] }));
    if (url.endsWith('/api/tool-notes')) return new Response('{"notes":{}}');
    if (url.endsWith('/api/mcp/call')) { bodies.push(JSON.parse(init.body)); return new Response('{"success":true,"result":{"content":[{"type":"text","text":"done"}]}}'); }
    throw new Error(url);
  };
  const reading = await mcpCatalog({ env: {}, fetchImpl, runtimeUrl: 'http://rt' });
  assert.deepEqual(reading[0].tools, ['read_file(path?): Read']);
  const writing = await mcpCatalog({ env: {}, fetchImpl, runtimeUrl: 'http://rt', write: true });
  assert.deepEqual(writing[0].tools, ['read_file(path?): Read', 'write_file(path?, content?) [changes: mcp-write]: Write'], 'a tool the operator did not open stays out');
  const { resolve } = plannerTools(['mcp-call', 'mcp-write'], mcpCatalogTools({write:true,runtimeUrl:'http://rt'}));
  const plan = planFromToolCalls({ tool_calls: [{ function: { name: 'mcp__filesystem__write_file', arguments: '{"path":"a.txt","content":"x"}' } }] }, resolve);
  assert.equal(plan.task.type, 'mcp-write');
  await callMcpTool({ server: 'filesystem', tool: 'write_file', arguments: {} }, { env: {}, fetchImpl, runtimeUrl: 'http://rt', mode: 'write' });
  await callMcpTool({ server: 'filesystem', tool: 'read_file', arguments: {} }, { env: {}, fetchImpl, runtimeUrl: 'http://rt' });
  assert.deepEqual(bodies.map(b => b.mode), ['write', 'read']);
  const { READ_ONLY_TASKS } = await import('../../agents/lib/approval-policy.mjs');
  const { BATCHABLE } = await import('../../agents/lib/mission-client.mjs');
  assert.equal(READ_ONLY_TASKS.has('mcp-write') || BATCHABLE.has('mcp-write'), false, 'never batched or repeated after an interruption');
});


test('Gameboard journal is the only write exception for built-in JacoEdit and never a file write grant', async () => {
  const { agentRefusal, defaultServers } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
  const prior = process.env.JACO_LITE;
  process.env.JACO_LITE = '1';
  let editor;
  try {
    const defaults=defaultServers({repoRoot:dir,runtimeRoot:dir});
    editor={id:'editor',transport:'stdio',...defaults.editor,deny:[]};
  } finally {
    if (prior === undefined) delete process.env.JACO_LITE;
    else process.env.JACO_LITE = prior;
  }
  assert.equal(editor.agentAccess,'read','the bundled editor must stay read-only by default');
  assert.equal(editor.gameboardJournalOnly,true);
  const tool={name:'gameboard_publish',readOnly:false};
  const request={eventId:'obs:a',scope:'mission:test',actorId:'spoofed',kind:'OBSERVATION',statement:'A concrete observation',expectedRevision:0};
  assert.equal(agentRefusal(editor,tool,request),null,'only coordinated journal append is admissible');
  assert.equal(agentRefusal(editor,{name:'write_file',readOnly:false},request),'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal(editor,{name:'start_goal',readOnly:false},request),'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal({...editor,agentAccess:'off'},tool,request),'MCP_AGENT_ACCESS_OFF');
  assert.equal(agentRefusal({...editor,deny:['gameboard_publish']},tool,request),'MCP_TOOL_DENIED');
  assert.equal(agentRefusal({...editor,transport:'http'},tool,request),'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY');
  assert.equal(agentRefusal({...editor,gameboardJournalOnly:undefined},tool,request),'MCP_TOOL_NOT_READ_ONLY','replacement MCP commands do not inherit exception');
  assert.equal(agentRefusal({...editor,id:'untrusted'},tool,request),'MCP_TOOL_NOT_READ_ONLY','server identity cannot impersonate the trusted editor');
  assert.equal(agentRefusal(editor,tool,{...request,kind:'EXECUTE'}),'MCP_GAMEBOARD_MESSAGE_INVALID');
  assert.equal(agentRefusal(editor,tool,{...request,expectedRevision:-1}),'MCP_GAMEBOARD_MESSAGE_INVALID');
  assert.equal(agentRefusal(editor,tool,{...request,scope:'other/malformed'}),'MCP_GAMEBOARD_MESSAGE_INVALID');
});

test('JACO Shell: agents write by default, explicit read/off/deny remain effective, and the workspace is the repo root', async () => {
  const { agentRefusal } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
  const servers = loadServerConfig({ configFile: path.join(dir, 'none.json'), repoRoot: dir, runtimeRoot: path.resolve('runtime') });
  assert.equal(servers.shell.agentAccess, 'write');
  assert.equal(servers.shell.env.JACO_SHELL_WORKSPACE, dir);
  assert.equal(agentRefusal(servers.shell, { name: 'shell_read', readOnly: true }), null);
  assert.equal(agentRefusal(servers.shell, { name: 'shell_run', readOnly: false }, { command: 'npm', args: ['test'] }), null);
  assert.equal(agentRefusal({...servers.shell,agentAccess:'read'}, { name: 'shell_run', readOnly: false }), 'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal({...servers.shell,agentAccess:'off'}, { name: 'shell_info', readOnly: true }), 'MCP_AGENT_ACCESS_OFF');
  assert.equal(agentRefusal({...servers.shell,deny:['shell_run']}, { name: 'shell_run', readOnly: false }), 'MCP_TOOL_DENIED');
  const explicit=path.join(dir,'explicit-shell-access.json');
  fs.writeFileSync(explicit,JSON.stringify({servers:{shell:{agentAccess:'read'}}}));
  assert.equal(loadServerConfig({configFile:explicit,repoRoot:dir,runtimeRoot:path.resolve('runtime')}).shell.agentAccess,'read');
  assert.equal(agentRefusal({ ...servers.shell, agentAccess: 'write' }, { name: 'shell_run', readOnly: false }, { command: 'npm', args: ['test'] }), null);
  const host = new StdioMcpHost({ configFile: path.join(dir, 'none.json'), repoRoot: dir, runtimeRoot: path.resolve('runtime') });
  try {
    const tools = await host.start('shell');
    assert.deepEqual(tools.map(t => t.name).sort(), ['shell_info', 'shell_read', 'shell_run']);
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hej\n');
    const out = await host.call('shell', 'shell_read', { command: 'cat', args: ['hello.txt'] });
    assert.match(JSON.stringify(out), /hej/);
    const run=await host.call('shell','shell_run',{command:'node',args:['-e',"require('node:fs').writeFileSync('shell-write-proof.txt','verified')"]},{actor:'agent'});
    assert.equal(JSON.parse(run.content[0].text).ok,true);
    assert.equal(fs.readFileSync(path.join(dir,'shell-write-proof.txt'),'utf8'),'verified');
  } finally { host.stopAll?.(); }
});

test('Lite offers the shell server on every host where its bundle exists', async () => {
  const { defaultServers } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-shell-'));
  const before = process.env.JACO_LITE; process.env.JACO_LITE = '1';
  try {
    assert.deepEqual(Object.keys(defaultServers({ repoRoot: dir, runtimeRoot })), ['jobbi', 'frantic', 'editor'], 'public discovery plus editor, no shell bundle');
    fs.mkdirSync(path.join(runtimeRoot, 'dist')); fs.writeFileSync(path.join(runtimeRoot, 'dist', 'jaco-shell.mjs'), '// bundle');
    const servers = defaultServers({ repoRoot: dir, runtimeRoot });
    {
      assert.deepEqual(Object.keys(servers), ['jobbi', 'frantic', 'editor', 'shell']);
      assert.equal(servers.shell.agentAccess, 'write');
      assert.equal(servers.shell.env.JACO_SHELL_WORKSPACE, dir);
    }
  } finally { if (before === undefined) delete process.env.JACO_LITE; else process.env.JACO_LITE = before; }
});

test('partial MCP discovery preserves ready tools and bounds slow connector waits',async()=>{
 const {mcpCatalogTools}=await import('../../agents/lib/mcp-tools.mjs');
 resetMcpCatalog({clearCooldowns:true});let starts=0;
 const ready={id:'fast',status:'READY',agentAccess:'read',tools:[{name:'read',description:'Read',readOnly:true,agentAllowed:true}]};
 const slow={id:'slow',status:'STOPPED',transport:'stdio',agentAccess:'read',tools:[]};
 const remote={id:'remote',transport:'http',status:'STOPPED',agentAccess:'read',tools:[]};
 const stopped={id:'stale',status:'FAILED',agentAccess:'read',tools:[{name:'old',readOnly:true}]};
 const disabled={id:'off',status:'READY',agentAccess:'off',tools:ready.tools};
 const fetchImpl=async(url)=>{
  if(url.endsWith('/api/mcp/start')){starts++;return new Promise(()=>{});}
  if(url.endsWith('/api/tool-notes'))return Response.json({notes:{}});
  return Response.json({success:true,servers:[ready,slow,remote,stopped,disabled]});
 };
 const begin=Date.now();const catalog=await mcpCatalog({runtimeUrl:'http://rt',env:{},fetchImpl,discoveryWaitMs:100});
 assert.ok(Date.now()-begin<2000);assert.equal(starts,1);assert.equal(catalog.find(s=>s.server==='slow').unavailable,true);
 assert.deepEqual(mcpCatalogTools({runtimeUrl:'http://rt'}).map(t=>t.server),['fast']);
 resetMcpCatalog({clearCooldowns:true});
});

test('revoked access during MCP handshake refuses dispatch and stale descriptors',async()=>{
 const cfg=path.join(dir,'race-access.json');fs.writeFileSync(cfg,JSON.stringify({servers:{fake:{command:process.execPath,args:[serverFile],agentAccess:'read'}}}));
 const host=new StdioMcpHost({configFile:cfg,repoRoot:dir,runtimeRoot:dir});
 try{
  const c=host.client('fake');const start=c.start.bind(c);
  c.start=async()=>{await start();host.setAccess('fake',{agentAccess:'off'});return c;};
  await assert.rejects(host.call('fake','echo',{}, {actor:'agent',readOnly:true}),e=>/MCP_AGENT_ACCESS_OFF/.test(e.message)&&e.dispatchState==='NOT_DISPATCHED');
 }finally{host.stopAll();}
});

test('concurrent refresh is single flight and keeps the prior snapshot until atomic publication',async()=>{
  const {mcpCatalogTools,learnedTaskNotes}=await import('../../agents/lib/mcp-tools.mjs');
  resetMcpCatalog({clearCooldowns:true});
  const base='http://single-flight';let gets=0,release;
  const ready={id:'fast',status:'READY',agentAccess:'write',tools:[{name:'read',readOnly:true,agentAllowed:true},{name:'write',readOnly:false,agentAllowed:true}]};
  const fetchImpl=async url=>{
    if(url.endsWith('/api/tool-notes'))return Response.json({notes:{shell:[{note:'known'}]}});
    gets++;
    if(gets===2)await new Promise(resolve=>{release=resolve;});
    return Response.json({servers:[ready]});
  };
  const options={runtimeUrl:base,env:{},fetchImpl};
  await mcpCatalog({...options,now:1000,write:true});
  const a=mcpCatalog({...options,now:17000,write:true});
  const b=mcpCatalog({...options,now:17000,write:false});
  assert.equal(gets,2,'both refresh callers share one network request');
  assert.deepEqual(mcpCatalogTools({runtimeUrl:base,write:true}).map(t=>t.name),['read','write']);
  assert.deepEqual(mcpCatalogTools({runtimeUrl:base}).map(t=>t.name),['read']);
  assert.equal(learnedTaskNotes({runtimeUrl:base}).shell,'known');
  release();
  const [write,read]=await Promise.all([a,b]);
  assert.equal(write[0].tools.length,2);assert.equal(read[0].tools.length,1);
  assert.deepEqual(mcpCatalogTools({runtimeUrl:base}).map(t=>t.name),['read']);
  assert.deepEqual(mcpCatalogTools({runtimeUrl:base,write:true}).map(t=>t.name),['read','write']);
  resetMcpCatalog({clearCooldowns:true});
});
test('runtime invalidation retains crash cooldown and never republishes a retired refresh',async()=>{
  const {mcpCatalogTools}=await import('../../agents/lib/mcp-tools.mjs');
  resetMcpCatalog({clearCooldowns:true});
  const base='http://cooldown';let starts=0;
  const fetchImpl=async url=>{
    if(url.endsWith('/api/tool-notes'))return Response.json({notes:{}});
    if(url.endsWith('/api/mcp/start')){starts++;return Response.json({success:false});}
    return Response.json({servers:[{id:'bad',status:'FAILED',agentAccess:'read',tools:[]}]});
  };
  const opts={runtimeUrl:base,env:{},fetchImpl};
  await mcpCatalog({...opts,now:1000});
  await callMcpTool({server:'bad',tool:'read'},{runtimeUrl:base,env:{},fetchImpl:async()=>new Response(JSON.stringify({error:'MCP_SERVER_EXITED:bad',success:false,dispatchState:'NOT_DISPATCHED'}),{status:409})});
  await mcpCatalog({...opts,now:2000});assert.equal(starts,1);
  await mcpCatalog({...opts,now:62000});assert.equal(starts,2);
  let release;
  const late=mcpCatalog({runtimeUrl:'http://late',env:{},fetchImpl:async url=>{
    if(url.endsWith('/api/tool-notes'))return Response.json({notes:{}});
    return new Promise(resolve=>{release=()=>resolve(Response.json({servers:[{id:'late',status:'READY',tools:[{name:'read',readOnly:true}]}]}));});
  }});
  const rejected=assert.rejects(late,/MCP_CATALOG_REFRESH_INVALIDATED/);
  resetMcpCatalog({runtimeUrl:'http://late'});release();await rejected;
  assert.deepEqual(mcpCatalogTools({runtimeUrl:'http://late'}),[]);
  resetMcpCatalog({clearCooldowns:true});
});
test('changed launch definition has no stale error, tools or start timestamp',async()=>{
 const cfg=path.join(dir,'changed-launch.json');
 const entry={command:process.execPath,args:[serverFile]};
 fs.writeFileSync(cfg,JSON.stringify({servers:{fake:entry}}));
 const host=new StdioMcpHost({configFile:cfg,repoRoot:dir,runtimeRoot:dir});
 try{
  await host.start('fake');host.clients.get('fake').error='retired error';
  fs.writeFileSync(cfg,JSON.stringify({servers:{fake:{...entry,args:[serverFile,'changed']}}}));
  const state=host.status().find(s=>s.id==='fake');
  assert.equal(state.status,'STOPPED');assert.deepEqual(state.tools,[]);
  assert.equal(state.error,null);assert.equal(state.startedAt,null);
 }finally{host.stopAll();}
});


test('failed custom MCP connections are disabled reversibly without affecting working or built-in servers', async t => {
  const cfg = path.join(dir, 'quarantine-' + process.pid + '.json');
  const missing = path.join(dir, 'missing-custom-mcp-entrypoint.mjs');
  const broken = {command:process.execPath,args:[missing],agentAccess:'write',env:{API_KEY:'${LOCAL_TEST_KEY}'}};
  const good = {command:process.execPath,args:[serverFile],agentAccess:'read'};
  const remote = {transport:'http',url:'https://offline.example.test/mcp',agentAccess:'read'};
  fs.writeFileSync(cfg,JSON.stringify({schema:'custom-layout',servers:{bad:broken,good,remote}}));
  t.after(()=>{fs.rmSync(cfg,{force:true})});
  const host=new StdioMcpHost({configFile:cfg,repoRoot:dir,runtimeRoot:dir});
  try {
    await host.start('good');
    await assert.rejects(host.start('bad'),/MCP_SERVER_EXITED:bad:ENTRYPOINT_NOT_FOUND/);
    assert.equal(host.status().find(x=>x.id==='bad').status,'FAILED');
    const remoteClient=host.client('remote');
    remoteClient.error='MCP_CONNECTION_FAILED'; // Observed transport failure; no network request here.
    assert.equal(host.status().find(x=>x.id==='remote').status,'FAILED');
    const repaired=host.quarantineFailedCustom();
    assert.deepEqual(repaired,{disabled:['bad','remote'],definitionsPreserved:true});
    const disk=JSON.parse(fs.readFileSync(cfg,'utf8'));
    assert.equal(disk.schema,'custom-layout');
    assert.deepEqual(disk.servers.bad,{...broken,enabled:false});
    assert.deepEqual(disk.servers.good,good);
    assert.deepEqual(disk.servers.remote,{...remote,enabled:false});
    assert.equal(host.status().some(x=>x.id==='bad'||x.id==='remote'),false);
    assert.equal(host.status().find(x=>x.id==='good').status,'READY');
    assert.ok(host.status().find(x=>x.id==='git'),'built-in git was not changed');
    assert.deepEqual(host.quarantineFailedCustom().disabled,[],'second run is idempotent');
    // Repair is reversible by restoring the saved definition.
    disk.servers.bad.enabled=true;
    fs.writeFileSync(cfg,JSON.stringify(disk));
    assert.equal(host.status().find(x=>x.id==='bad').status,'STOPPED');
  } finally {host.stopAll()}
});

test('non-MCP Node script exits with an actionable handshake error, not a misleading READY state', async t => {
  const script=path.join(dir,'non-mcp-cli.mjs');
  const cfg=path.join(dir,'non-mcp-cli.json');
  fs.writeFileSync(script,'process.stdout.write("dry run complete\\n");\n');
  fs.writeFileSync(cfg,JSON.stringify({servers:{demo:{command:process.execPath,args:[script]}}}));
  t.after(()=>{fs.rmSync(script,{force:true});fs.rmSync(cfg,{force:true})});
  const host=new StdioMcpHost({configFile:cfg,repoRoot:dir,runtimeRoot:dir});
  try {
    await assert.rejects(host.start('demo'),/MCP_SERVER_EXITED:demo:NO_MCP_HANDSHAKE/);
    const state=host.status().find(x=>x.id==='demo');
    assert.equal(state.status,'FAILED');
    assert.deepEqual(state.tools,[]);
    assert.equal(state.error,'MCP_SERVER_EXITED:demo:NO_MCP_HANDSHAKE');
  } finally {host.stopAll()}
});
