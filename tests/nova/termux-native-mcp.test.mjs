import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SafeShell } from '../../agents/lib/safe-shell.mjs';
import { defaultServers, loadServerConfig, StdioMcpHost } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import { handleGitMcp } from '../../runtime/tools/jaco-git-mcp.mjs';
import { checkedUrl, fetchPublicText, handleFetchMcp } from '../../runtime/tools/jaco-fetch-mcp.mjs';

const runtimeRoot = path.resolve('runtime');
const createTemp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'jaco-native-mcp-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true})); return dir; };
const request = (id, name, args = {}) => ({ jsonrpc:'2.0', id, method:'tools/call', params:{name,arguments:args} });
const parsed = response => JSON.parse(response.result.content[0].text);

test('full runtime Git and Fetch require only Node, and legacy uvx definitions migrate without losing permissions', t => {
  const before = process.env.JACO_LITE;
  delete process.env.JACO_LITE;
  t.after(() => before === undefined ? delete process.env.JACO_LITE : process.env.JACO_LITE = before);
  const dir=createTemp(t);
  const defaults=defaultServers({repoRoot:dir,runtimeRoot});
  assert.equal(defaults.git.command,process.execPath);
  assert.equal(defaults.fetch.command,process.execPath);
  assert.match(defaults.git.args[0],/jaco-git-mcp\.mjs$/);
  assert.match(defaults.fetch.args[0],/jaco-fetch-mcp\.mjs$/);
  const cfg=path.join(dir,'servers.json');
  fs.writeFileSync(cfg, JSON.stringify({servers:{
    git:{command:'uvx',args:['mcp-server-git','--repository',dir],agentAccess:'read',deny:['git_push']},
    fetch:{command:'uvx',args:['mcp-server-fetch'],agentAccess:'off'},
    custom:{command:'uvx',args:['other-tool']}
  }}));
  const migrated=loadServerConfig({configFile:cfg,repoRoot:dir,runtimeRoot});
  assert.equal(migrated.git.command,process.execPath);
  assert.equal(migrated.git.agentAccess,'read');
  assert.deepEqual(migrated.git.deny,['git_push']);
  assert.equal(migrated.fetch.command,process.execPath);
  assert.equal(migrated.fetch.agentAccess,'off');
  assert.equal(migrated.custom.command,'uvx');
});

test('native git MCP stages and commits via SafeShell without Python or a shell', async t => {
  const dir=createTemp(t);
  execFileSync('git',['init','-q'],{cwd:dir});
  execFileSync('git',['config','user.name','JACO MCP fixture'],{cwd:dir});
  execFileSync('git',['config','user.email','fixture@example.test'],{cwd:dir});
  fs.writeFileSync(path.join(dir,'hello.txt'),'hello\n');
  const shell=new SafeShell({workspace:dir,auditFile:false});
  const listed=await handleGitMcp({id:1,method:'tools/list'},{shell});
  assert.equal(listed.result.tools.length,9);
  assert.equal(parsed(await handleGitMcp(request(2,'git_add',{path:'hello.txt'}),{shell})).ok,true);
  const committed=parsed(await handleGitMcp(request(3,'git_commit',{message:'test: native MCP commit'}),{shell}));
  assert.equal(committed.ok,true, JSON.stringify(committed));
  assert.match(execFileSync('git',['log','-1','--format=%s'],{cwd:dir,encoding:'utf8'}),/native MCP commit/);
  const status=parsed(await handleGitMcp(request(4,'git_status'),{shell}));
  assert.equal(status.ok,true);
  const push=parsed(await handleGitMcp(request(5,'git_push'),{shell}));
  assert.equal(push.refused,true);
  assert.match(push.reason,/GIT_PUSH_NOT_ENABLED/);
});

test('Git and Fetch stdio servers spawn and advertise tools in full runtime', async t => {
  const dir=createTemp(t);
  execFileSync('git',['init','-q'],{cwd:dir});
  const host=new StdioMcpHost({configFile:path.join(dir,'missing.json'),repoRoot:dir,runtimeRoot});
  t.after(()=>host.stopAll());
  const git=await host.start('git'); assert.ok(git.some(x=>x.name==='git_commit'));
  const fetch=await host.start('fetch'); assert.deepEqual(fetch.map(x=>x.name),['fetch']);
});

test('native Fetch blocks nonpublic URLs, DNS targets, and exposes one read-only MCP tool', async () => {
  for (const url of ['http://example.com','https://localhost/','https://10.0.0.2/','https://example.com:8443/','https://user:pass@example.com/']) {
    assert.throws(()=>checkedUrl(url),/FETCH_PUBLIC_HTTPS_REQUIRED/,url);
  }
  await assert.rejects(fetchPublicText('https://example.com/',{lookupFn:async()=>[{address:'127.0.0.1'}],requestFn:()=>{throw Error('should not request');}}),/FETCH_ADDRESS_NOT_PUBLIC/);
  const listed=await handleFetchMcp({id:1,method:'tools/list'});
  assert.deepEqual(listed.result.tools.map(x=>x.name),['fetch']);
  assert.equal(listed.result.tools[0].annotations.readOnlyHint,true);
  const mocked=await handleFetchMcp(request(2,'fetch',{url:'https://example.com/'}),{fetchFn:async()=>({content:'hello'})});
  assert.equal(mocked.result.content[0].text,'hello');
});
