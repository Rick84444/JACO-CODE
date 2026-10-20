import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url));
import { createWorkspaceAttachments } from '../../runtime/src/server/connected/workspaceAttachments.mjs';
import { StdioMcpHost } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';
import { installSkill, loadSkill, skillMissionSpec } from '../../agents/lib/skills.mjs';
import { JacoCoreClient } from '../../runtime/gateway/src/jaco-client.mjs';
import { createToolRegistry } from '../../runtime/gateway/src/tool-registry.mjs';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-inputs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const upload=(name,content)=>({path:name,base64:Buffer.from(content).toString('base64')});

test('uploaded directory copies retain paths, bytes and hashes across reopen; text reads are paginated',t=>{
 const root=fixture(t),store=createWorkspaceAttachments(root);
 const saved=store.create([upload('notes/a.txt','hello world'),upload('notes/sub/b.txt','second'),upload('photo.bin',Buffer.from([0,255,1]))]);
 const reopened=createWorkspaceAttachments(root);
 assert.equal(reopened.manifest(saved.id).files.length,3);
 assert.deepEqual(reopened.read(saved.id,'notes/a.txt',0,5).content,'hello');
 assert.equal(reopened.read(saved.id,'notes/a.txt',5,6).content,' world');
 assert.equal(reopened.read(saved.id).files.length,3);
 assert.equal(reopened.read(saved.id,'photo.bin').readable,false);
 assert.equal(reopened.manifest(saved.id).files[2].sha256.length,64);
 fs.writeFileSync(path.join(root,saved.id,'files','notes/a.txt'),'changed');
 assert.throws(()=>store.read(saved.id,'notes/a.txt'),/CONTENT_CHANGED/);
});

test('attachment imports refuse escapes, secrets, links, duplicate aliases and oversized data without partial batches',t=>{
 const root=fixture(t),store=createWorkspaceAttachments(root);
 for(const name of ['../escape','/absolute','.env','folder/.env.local','.git/config','node_modules/x','file:stream','a\\b','CON.txt']) assert.throws(()=>store.create([upload(name,'x')]),/PATH_/);
 assert.throws(()=>store.create([upload('a','x'),upload('A','y')]),/DUPLICATE/);
 assert.throws(()=>store.create([upload('huge',Buffer.alloc(6000001))]),/SIZE_LIMIT/);
 assert.deepEqual(fs.readdirSync(root),[]);
 const saved=store.create([upload('file.txt','x')]);
 const file=path.join(root,saved.id,'files','file.txt');fs.unlinkSync(file);fs.symlinkSync(path.join(root,'elsewhere'),file);
 assert.throws(()=>store.read(saved.id,'file.txt'),/LINK_DENIED/);
 assert.throws(()=>store.context(['../../root']),/ID_INVALID/);
});

test('secret redaction happens before text pagination',t=>{
 const store=createWorkspaceAttachments(fixture(t)),key='sk-proj-'+ 'A'.repeat(55);
 const saved=store.create([upload('note.txt','prefix '+key+' suffix')]);
 const full=store.read(saved.id,'note.txt').content;
 assert.ok(!full.includes(key));
 const part=store.read(saved.id,'note.txt',8,10).content;
 assert.ok(!part.includes('A'.repeat(8)));
});

test('a local MCP command actually executes in the selected project and follows project changes',async t=>{
 const root=fixture(t),other=path.join(root,'second');fs.mkdirSync(other);fs.writeFileSync(path.join(root,'first.txt'),'one');fs.writeFileSync(path.join(other,'second.txt'),'two');
 const host=new StdioMcpHost({configFile:path.join(root,'config.json'),repoRoot:root,runtimeRoot:path.join(repo,'runtime')});t.after(()=>host.stopAll());
 const tools=await host.start('shell');assert.ok(tools.some(tool=>tool.name==='shell_read'));
 const call=async()=>JSON.parse((await host.call('shell','shell_read',{command:'node',args:['--version']},{actor:'agent',readOnly:true})).content[0].text);
 const first=await call();assert.equal(first.exitCode,0);assert.match(first.stdout,/v\d+\./);
 host.useWorkspaceRoot(other);
 const second=JSON.parse((await host.call('shell','shell_info',{},{actor:'agent',readOnly:true})).content[0].text);
 assert.ok(JSON.stringify(second).includes(other));
 fs.writeFileSync(path.join(other,'make.mjs'),"import fs from 'node:fs'; fs.writeFileSync('proof.txt','actual command result');");
 const written=JSON.parse((await host.call('shell','shell_run',{command:'node',args:['make.mjs']},{actor:'operator'})).content[0].text);
 assert.equal(written.exitCode,0);assert.equal(fs.readFileSync(path.join(other,'proof.txt'),'utf8'),'actual command result');
 fs.writeFileSync(path.join(other,'fail.mjs'),"process.stderr.write('actual failure');process.exit(7);");
 const failed=await host.call('shell','shell_run',{command:'node',args:['fail.mjs']},{actor:'operator'});
 assert.equal(failed.isError,true);const failure=JSON.parse(failed.content[0].text);assert.equal(failure.exitCode,7);assert.equal(failure.stderr,'actual failure');
 assert.equal(host.status().find(s=>s.id==='shell').stats.lastCall.outcome,'tool_error');
 await assert.rejects(host.call('shell','shell_run',{command:'node',args:['x.mjs']},{actor:'agent',readOnly:true}),/NOT_READ_ONLY|WRITE|ACCESS/);
});

test('provider observations return changing real model IDs, not configured defaults',async t=>{
 const root=fixture(t);let model='first-model';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:model}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const registry=new ProviderRegistry(root,{});registry.providers.clear();registry.register({id:'local-test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,defaultModel:'not-observed'});
 const first=await registry.scan();assert.deepEqual(first[0].modelIds,['first-model']);assert.equal(first[0].active,true);
 model='second-model';assert.deepEqual((await registry.scan())[0].modelIds,['second-model']);
});

test('malformed HTTP-success model catalogs cannot become selectable models',async t=>{
 const root=fixture(t);let payload='{}';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(payload);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const registry=new ProviderRegistry(root,{});registry.providers.clear();registry.register({id:'catalog-test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
 for(const value of ['not json','{}','{"data":{}}','{"data":[{"id":42}]}','{"data":[{"id":{"name":"broken"}}]}','{"data":[{"id":"   "}]}','{"data":[{"id":"valid"},{}]}']) {
  payload=value;const observed=(await registry.scan())[0];
  assert.equal(observed.active,false,value);assert.deepEqual(observed.modelIds,[],value);
  const probe=await registry.probe('catalog-test');assert.equal(probe.status,200);assert.equal(probe.error,'PROVIDER_MODELS_INVALID');
 }
 payload='{"data":[]}';assert.equal((await registry.scan())[0].active,true);
 payload='{"data":[{"id":"real-model"},{"id":"real-model"}]}';assert.deepEqual((await registry.scan())[0].modelIds,['real-model']);
});

test('imported coding skills use bounded project contracts and explicit test commands',t=>{
 const root=fixture(t),skillText='---\nname: Code review\ndescription: Inspect and verify\ntasks: [repo-read, repo-edit, repo-test]\n---\nRead the project and verify the requested change.';
 installSkill(root,'code-review',skillText);const skill=loadSkill([root],'code-review');
 assert.throws(()=>installSkill(root,'code-review',skillText),/ALREADY_EXISTS/);
 assert.throws(()=>skillMissionSpec(skill,{input:'Inspect',projectRoot:root}),/TEST_COMMANDS_REQUIRED/);
 const spec=skillMissionSpec(skill,{input:'Inspect',projectRoot:root,testCommands:['node --test']});
 assert.deepEqual(spec.allowedTasks,['repo-read','repo-edit','repo-test']);assert.equal(spec.projectRoot,root);assert.equal(spec.contract.execution.allow_git_push,false);
 assert.throws(()=>skillMissionSpec(skill,{input:'Inspect',projectRoot:root,testCommands:['node --test'],executor:'remote-device'}),/LOCAL_ONLY/);
});

test('the canonical attachment MCP tool reads stored bytes through the authenticated HTTP client',async t=>{
 const store=createWorkspaceAttachments(fixture(t)),batch=store.create([upload('source.txt','actual uploaded content')]);
 const server=http.createServer((req,res)=>{
  if(req.headers['x-gateway-token']!=='fixture-test-token'){res.writeHead(401);res.end('{}');return;}
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({success:true,result:store.read(url.pathname.split('/').at(-1),url.searchParams.get('path'),url.searchParams.get('offset'),url.searchParams.get('limit'))}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const core=new JacoCoreClient({baseUrl:`http://127.0.0.1:${server.address().port}`,token:'fixture-test-token'});
 const tool=createToolRegistry({core,system:{},modelId:'test'}).find(t=>t.name==='jaco_attachment_read');
 assert.equal(tool.config.annotations.readOnlyHint,true);
 const result=await tool.handler({id:batch.id,path:'source.txt'});
 assert.equal(result.result.content,'actual uploaded content');
});
