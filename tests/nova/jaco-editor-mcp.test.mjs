import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A stand-in for the runtime's workbench endpoints: one file with a content hash, like the real ones.
const files = new Map([['a.txt', 'one\ntwo\ntwo\n']]);
const hashOf = s => `h${s.length}:${s.split('').reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const p = url.searchParams.get('path');
    if (req.method === 'GET' && url.pathname === '/api/aura/workbench/file') {
      return files.has(p) ? send(200, { success: true, path: p, content: files.get(p), size: files.get(p).length, language: 'text', hash: hashOf(files.get(p)) }) : send(400, { success: false, error: 'ENOENT' });
    }
    if (req.method === 'PUT' && url.pathname === '/api/aura/workbench/file') {
      const b = JSON.parse(body);
      if (files.has(b.path) && !b.expectedHash) return send(400, { success: false, error: 'WORKBENCH_EXPECTED_HASH_REQUIRED' });
      if (files.has(b.path) && b.expectedHash !== hashOf(files.get(b.path))) return send(409, { success: false, error: 'WORKBENCH_FILE_CONFLICT' });
      files.set(b.path, b.content);
      return send(200, { success: true, path: b.path, hash: hashOf(b.content), size: b.content.length });
    }
    send(404, { success: false, error: 'NOT_FOUND' });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.JACO_RUNTIME_URL = `http://127.0.0.1:${server.address().port}`;
const { TOOLS, handle } = await import('../../runtime/tools/jaco-editor-mcp.mjs');
const call = async (name, args) => {
  const out = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { error: Boolean(out.result.isError), text: out.result.content[0].text };
};
test.after(() => server.close());

test('lists the editor tools; read-only ones are annotated, delete is destructive', async () => {
  const { result } = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const by = Object.fromEntries(result.tools.map(t => [t.name, t]));
  assert.ok(['read_file', 'edit_file', 'write_file', 'git_action', 'start_goal'].every(n => by[n]));
  assert.equal(by.read_file.annotations.readOnlyHint, true);
  assert.equal(by.edit_file.annotations.readOnlyHint, false);
  assert.equal(by.delete_file.annotations.destructiveHint, true);
  assert.equal(result.tools.length, TOOLS.length);
  assert.ok(!result.tools.some(t => /shell|exec|terminal/.test(t.name)), 'no shell tool');
});

test('edit_file needs a unique match, replaces literally, and writes against the hash it read', async () => {
  assert.match((await call('edit_file', { path: 'a.txt', old: 'two', new: 'x' })).text, /EDIT_OLD_NOT_UNIQUE:2/);
  assert.match((await call('edit_file', { path: 'a.txt', old: 'nope', new: 'x' })).text, /EDIT_OLD_NOT_FOUND/);
  const ok = await call('edit_file', { path: 'a.txt', old: 'one', new: '$&1' });
  assert.equal(ok.error, false);
  assert.equal(files.get('a.txt'), '$&1\ntwo\ntwo\n');
});

test('an overwrite with a stale or missing hash is refused', async () => {
  assert.match((await call('write_file', { path: 'a.txt', content: 'x' })).text, /WORKBENCH_EXPECTED_HASH_REQUIRED/);
  assert.match((await call('write_file', { path: 'a.txt', content: 'x', expectedHash: 'stale' })).text, /WORKBENCH_FILE_CONFLICT/);
  assert.equal((await call('write_file', { path: 'new.txt', content: 'hi' })).error, false);
});

test('errors are returned to the client as tool errors, not thrown', async () => {
  const r = await call('read_file', { path: 'missing.txt' });
  assert.equal(r.error, true);
  assert.match((await call('read_file', {})).text, /PATH_REQUIRED/);
});


test('gameboard publish binds the actor to the synchronized Workplace identity, rejecting client impersonation', async () => {
  const seen = [];
  const { createEditorServer } = await import('../../runtime/tools/jaco-editor-mcp.mjs');
  const editor=createEditorServer({
    env:{JACO_RUNTIME_URL:'http://127.0.0.1:3000'},
    fetchImpl:async (url, options) => {
      if (url.endsWith('/project')) return {ok:true,json:async()=>({success:true,root:'/test/attested'})};
      if (url.endsWith('/gameboard/events') && options.method==='POST') {
        const payload=JSON.parse(options.body);
        seen.push(payload);
        return {ok:true,json:async()=>({success:true,accepted:true,entry:payload})};
      }
      throw Error('UNEXPECTED_MOCK_ROUTE:'+url);
    },
    join:async()=>({
      client:{agentId:'attested-workplace-agent'},
      state:'READY',
      syncNow:async()=>true,
      setActivity:async()=>{},
      end:async()=>{},
    }),
    managed:true,
  });
  try {
    const initialized=await editor.handle({jsonrpc:'2.0',id:100,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'attested-test'}}});
    assert.ok(initialized.result);
    const output=await editor.handle({jsonrpc:'2.0',id:101,method:'tools/call',params:{
      name:'gameboard_publish',arguments:{
        scope:'global',eventId:'attested-1',kind:'OBSERVATION',statement:'verified socket open',
        actorId:'impersonated-agent',expectedRevision:0,
      },
    }});
    assert.equal(output.result.isError,undefined);
    assert.equal(seen.length,1);
    assert.equal(seen[0].actorId,'attested-workplace-agent');
    assert.notEqual(seen[0].actorId,'impersonated-agent');
  } finally {await editor.close();}
});
