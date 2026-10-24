import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { configuration, definitions, serviceEnvironment, activate, runtimeDirectory, tunnelCommandMatches, pendingProcess, ollamaExecutable } from '../../agents/lib/local-stack.mjs';
const IDENTITY="app.get('/api/runtime/identity',()=>{});";
function fixture(t, env = {}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-start-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'server.ts'),IDENTITY);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'9.8.7'}));
 fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'dist/server.cjs'),'');fs.writeFileSync(path.join(root,'dist/index.html'),'');
 return configuration(root,{JACO_RUNTIME_DIR:root,JACO_GATEWAY_TOKEN:'test-only-token-with-24-characters',JACO_MODEL_PROVIDER:'fixture',...env});
}
test('validates ports and preserves spending authorization',t=>{
 assert.throws(()=>fixture(t,{PORT:'invalid'}),/INVALID_PORT:PORT/);
 const c=fixture(t,{PORT:'33123',JACO_ALLOW_PAID_MODELS:'0'});
 assert.equal(c.env.JACO_RUNTIME_URL,'http://127.0.0.1:33123');
 assert.equal(c.env.JACO_ALLOW_PAID_MODELS,'0');
 assert.equal(c.env.HOST,'127.0.0.1');
});
test('runtime discovery survives renamed directories and resolves relative paths from installation root',t=>{
 const c=fixture(t),child=path.join(c.root,'Runtime with spaces');fs.mkdirSync(child);
 fs.renameSync(path.join(c.root,'server.ts'),path.join(child,'server.ts'));
 fs.writeFileSync(path.join(child,'package.json'),JSON.stringify({version:'10.2.0'}));
 assert.equal(runtimeDirectory(c.root),child);
 const moved=configuration(c.root,{JACO_RUNTIME_DIR:'Runtime with spaces'});
 assert.equal(moved.runtime,child);assert.equal(moved.version,'10.2.0');
 fs.mkdirSync(path.join(c.root,'other'));fs.writeFileSync(path.join(c.root,'other/server.ts'),IDENTITY);fs.writeFileSync(path.join(c.root,'other/package.json'),'{}');
 assert.throws(()=>runtimeDirectory(c.root),/AMBIGUOUS/);
});
test('a server.ts without the identity route is not a runtime, so the legacy root app is skipped',t=>{
 const c=fixture(t),child=path.join(c.root,'Runtime');fs.mkdirSync(child);
 fs.writeFileSync(path.join(c.root,'server.ts'),'// legacy app');
 fs.writeFileSync(path.join(child,'server.ts'),IDENTITY);fs.writeFileSync(path.join(child,'package.json'),'{}');
 assert.equal(runtimeDirectory(c.root),child);
});
test('inherited configuration wins and configured listener ports are propagated',t=>{
 const c=fixture(t);fs.writeFileSync(path.join(c.root,'.env'),'PORT=34000\nCDP_PORT=9400\nJACO_ALLOW_PAID_MODELS=0\n');
 const next=configuration(c.root,{PORT:'34001',JACO_ENABLE_CDP:'1',JACO_RUNTIME_DIR:c.root});
 assert.equal(next.ports.runtime,34001);assert.equal(next.ports.chrome,9400);assert.equal(next.env.CDP_PORT,'9400');
 assert.equal(next.env.NOVA_BRIDGE_URL,next.env.JACO_NOVA_URL);assert.equal(next.env.JACO_ALLOW_PAID_MODELS,'0');
 assert.throws(()=>configuration(c.root,{PORT:'2995',JACO_RUNTIME_DIR:c.root}),/DUPLICATE_LISTENER_PORT/);
});
test('a checkout .env does not hide the credentials kept in the state directory',t=>{
 const c=fixture(t),state=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-state-test-'));
 t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 fs.writeFileSync(path.join(state,'.env'),['JACO_GATEWAY_TOKEN=state-token-with-at-least-24-chars','JACO_WORKPLACE_TOKEN=state-workplace-token-24-chars',''].join('\n'));
 fs.writeFileSync(path.join(c.root,'.env'),['JACO_HUB_URL=https://hub.example.test','JACO_WORKPLACE_TOKEN=checkout-workplace-token-24-char',''].join('\n'));
 const next=configuration(c.root,{JACO_RUNTIME_DIR:c.root,JACO_STATE_DIR:state});
 assert.equal(next.env.GATEWAY_TOKEN,'state-token-with-at-least-24-chars','the token exists only in the state directory');
 assert.equal(next.env.JACO_HUB_URL,'https://hub.example.test');
 assert.equal(next.env.JACO_WORKPLACE_TOKEN,'checkout-workplace-token-24-char','the checkout file is more specific than the state directory');
});
test('production mode requires both artifacts and sets production environment',t=>{
 const c=fixture(t,{JACO_START_MODE:'production'});
 assert.equal(c.production,true);assert.equal(serviceEnvironment(c,'runtime').NODE_ENV,'production');
 fs.unlinkSync(path.join(c.runtime,'dist/index.html'));
 assert.throws(()=>configuration(c.root,{JACO_RUNTIME_DIR:c.root,JACO_START_MODE:'production'}),/PRODUCTION_BUILD_REQUIRED/);
});
test('tunnel adoption requires exact configuration argument',()=>{
 const file=path.resolve('logs/cloudflared-config.yml');
 assert.equal(tunnelCommandMatches('cloudflared.exe tunnel --config "'+file+'" run',file),true);
 assert.equal(tunnelCommandMatches('cloudflared.exe tunnel --config "'+file+'.other" run',file),false);
 assert.equal(tunnelCommandMatches('cloudflared.exe tunnel --url "'+file+'" run',file),false);
});
test('withholds payment and publication secrets while preserving runtime models and state root',t=>{
 const c=fixture(t,{STRIPE_SECRET_KEY:'fixture',GITHUB_TOKEN:'fixture',CLOUDFLARE_API_TOKEN:'fixture',OLLAMA_API_KEY:'model',HUGGINGFACE_TOKEN:'hf',JACO_WORKSPACE_ROOT:'wrong'});
 const e=serviceEnvironment(c,'runtime');
 for(const k of ['STRIPE_SECRET_KEY','GITHUB_TOKEN','CLOUDFLARE_API_TOKEN'])assert.equal(e[k],'');
 assert.equal(e.OLLAMA_API_KEY,'model');assert.equal(e.HUGGINGFACE_TOKEN,'hf');assert.equal(e.JACO_WORKSPACE_ROOT,undefined);
 assert.equal(serviceEnvironment(c,'workplace').HUGGINGFACE_TOKEN,'');
});
test('emergency latch prevents all startup effects',async t=>{
 const c=fixture(t);fs.writeFileSync(path.join(c.root,'.jaco-emergency-stop.json'),'{}');
 await assert.rejects(activate(c),/EMERGENCY_STOP_ACTIVE/);assert.equal(fs.existsSync(path.join(c.root,'logs')),false);
});
test('cannot steal a live startup lock',async t=>{
 const c=fixture(t);const dir=path.join(c.root,'logs/startup');fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'startup.lock');fs.writeFileSync(lock,String(process.pid));
 await assert.rejects(activate(c),/STARTUP_ALREADY_IN_PROGRESS/);assert.equal(fs.readFileSync(lock,'utf8'),String(process.pid));
});
test('pending service process requires a matching creation time, not just a PID',{skip:process.platform!=='win32'},t=>{
 const c=fixture(t),dir=path.join(c.root,'logs/startup');fs.mkdirSync(dir,{recursive:true});
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter "ProcessId=${process.pid}").CreationDate.ToUniversalTime().ToString('o')`],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.trim());
 const file=path.join(dir,'runtime.process.json');fs.writeFileSync(file,JSON.stringify({pid:process.pid,birth:result.stdout.trim()}));
 assert.equal(pendingProcess(c,'runtime'),process.pid);
 fs.writeFileSync(file,JSON.stringify({pid:process.pid,birth:'wrong-process-birth'}));
 assert.throws(()=>pendingProcess(c,'runtime'),/PROCESS_OWNER_NOT_VERIFIED/);
});
test('foreign listener blocks startup and stays running with failure evidence',async t=>{
 const server=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end('{"success":true,"releaseId":"foreign"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const c=fixture(t,{PORT:String(server.address().port),JACO_ENABLE_CDP:'1'});
 await assert.rejects(activate(c),/PORT_CONFLICT_OR_UNHEALTHY:runtime/);
 assert.equal(server.listening,true);
 const receipt=JSON.parse(fs.readFileSync(path.join(c.root,'logs/startup/status.json')));
 assert.equal(receipt.state,'BLOCKED');assert.deepEqual(receipt.services,[]);
 assert.equal(fs.existsSync(path.join(c.root,'logs/startup/startup.lock')),false);
});
test('PowerShell wrapper preserves BOM and preflight has no launch effects',{skip:process.platform!=='win32'},()=>{
 const file=path.resolve('agents/start-all.ps1');assert.equal(fs.readFileSync(file,'utf8').charCodeAt(0),0xFEFF);
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,'-PreflightOnly'],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).schema,'jaco.startup-preflight/v1');
});

test('Ollama discovery uses the host binary name and preserves explicit configuration', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-ollama-path-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const unix=path.join(dir,'ollama'), windows=path.join(dir,'ollama.exe'), custom=path.join(dir,'custom-model-server');
 for(const file of [unix,windows,custom])fs.writeFileSync(file,'fixture');
 assert.equal(ollamaExecutable({PATH:dir},'linux'),unix);
 assert.equal(ollamaExecutable({PATH:dir},'darwin'),unix);
 assert.equal(ollamaExecutable({PATH:dir},'win32'),windows);
 assert.equal(ollamaExecutable({PATH:dir,JACO_OLLAMA_EXECUTABLE:custom},'linux'),custom);
 assert.equal(ollamaExecutable({PATH:dir,JACO_OLLAMA_EXECUTABLE:path.join(dir,'missing')},'linux'),null);
 fs.unlinkSync(unix);
 assert.equal(ollamaExecutable({PATH:dir},'linux'),null);
});

test('runtime identity rejects a stale release despite matching package version', t => {
 const initial=fixture(t);
 const current='jaco-code-9.8.7';
 fs.writeFileSync(path.join(initial.runtime,'CURRENT_RELEASE.json'), JSON.stringify({ version: initial.version, releaseId: current }));
 const c=configuration(initial.root,{JACO_RUNTIME_DIR:initial.root});
 assert.equal(c.releaseId,current);
 const runtime=definitions(c).find(service=>service.id==='runtime');
 const response={success:true,product:'JACO Autonomus IDE',version:c.version};
 assert.equal(runtime.accept({...response,releaseId:current}),true);
 assert.equal(runtime.accept({...response,releaseId:'jaco-code-older'}),false);
 assert.equal(runtime.accept(response),false);
 fs.writeFileSync(path.join(initial.runtime,'CURRENT_RELEASE.json'), JSON.stringify({ version: 'older', releaseId: current }));
 assert.throws(()=>configuration(initial.root,{JACO_RUNTIME_DIR:initial.root}),/RUNTIME_RELEASE_VERSION_MISMATCH/);
});
