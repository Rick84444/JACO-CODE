import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {githubGuiAuth} from '../../runtime/src/server/connected/githubGuiAuth.mjs';
import {prepareLiteBrowser} from '../../agents/lib/lite-browser-supervisor.mjs';
import {automaticConnections} from '../../runtime/src/server/connected/automaticConnections.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function fakeChild(){
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;
 child.kill=()=>{child.killed=true;child.emit('close',null,'SIGTERM');return true;};
 return child;
}
test('GUI GitHub OAuth uses official CLI, exposes only device code and verifies Git helper',async()=>{
 let signedIn=false, configured=false, starts=0;
 const child=fakeChild();
 const auth=githubGuiAuth({env:{PATH:'/bin',GITHUB_TOKEN:'background-secret-not-for-login'},
 run:async(file,args,opts)=>{
   assert.equal(opts.env.GITHUB_TOKEN,undefined);
   if(file==='git')return {stdout:configured?'!gh auth git-credential':''};
   if(args[0]==='api'){
     if(!signedIn)throw Error('not signed in');
     return {stdout:'fixture-user\n'};
   }
   assert.deepEqual(args,['auth','setup-git','--hostname','github.com']);configured=true;return {stdout:''};
 },
 spawnImpl:(cmd,args,opts)=>{
   starts++;assert.equal(cmd,'gh');assert.equal(opts.shell,false);
   assert.ok(args.includes('--web'));assert.equal(opts.env.GITHUB_TOKEN,undefined);
   return child;
 }});
 assert.equal((await auth.status()).state,'SIGN_IN_REQUIRED');
 await auth.start();await auth.start();assert.equal(starts,1);
 child.stderr.emit('data','First copy your one-time code: AB12-CD34\n');
 child.stderr.emit('data','raw-debug-output-that-must-not-be-returned');
 assert.deepEqual(await auth.status(),{state:'WAITING_FOR_USER',code:'AB12-CD34',verificationUrl:'https://github.com/login/device'});
 signedIn=true;child.emit('close',0,null);await tick();
 const result=await auth.status();
 assert.equal(result.login,'fixture-user');assert.equal(result.gitConfigured,true);
 assert.doesNotMatch(JSON.stringify(result),/AB12|background-secret|raw-debug/);
});

test('Lite browser prerequisites do not block Core; healthy own children use distinct ports and stop',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-lite-browser-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'dist'));
 for(const f of ['nova-bridge.mjs','cdp-bridge.mjs'])fs.writeFileSync(path.join(dir,'dist',f),'fixture');
 const base={env:{JACO_CHROME_EXECUTABLE:process.execPath},installDir:dir,project:dir,corePort:3000,workplacePort:2995,
 workplaceReady:true,findPort:async(n,{check})=>{while(!await check(n))n++;return n;},portFree:async()=>true};
 const disabled=await prepareLiteBrowser({...base,env:{...base.env,JACO_ENABLE_CDP:'0'}});
 assert.equal(disabled.reason,'CDP_POLICY');
 const unavailable=await prepareLiteBrowser({...base,workplaceReady:false});
 assert.equal(unavailable.reason,'WORKPLACE_NOT_READY');
 const launch=await prepareLiteBrowser(base);
 assert.equal(launch.env.JACO_LITE_BROWSER_AVAILABLE,'1');
 assert.equal(new Set([3000,2995,Number(launch.env.CDP_PORT),Number(launch.env.NOVA_BRIDGE_PORT),Number(launch.env.JACO_CDP_BRIDGE_PORT)]).size,5);
 const children=[],events=[];
 await launch.start({token:'test-internal-token-not-for-chrome',spawnImpl:(_cmd,args,opts)=>{
   if(children.length===0){assert.equal(opts.env.JACO_GATEWAY_TOKEN,undefined);assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));assert.ok(!args.includes('--no-sandbox'));}
   const child=fakeChild();children.push(child);return child;
 },fetchImpl:async(url,opts)=>{
   if(url.endsWith('/json/version')){assert.equal(opts.headers,undefined);return Response.json({webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/test'});}
   return Response.json({ok:true,browserVerified:true,state:'READY',verificationAgeMs:0});
 },report:e=>events.push(e)});
 assert.equal(children.length,3);assert.ok(events.some(e=>e.component==='browser'&&e.event==='READY'));
 launch.stop();assert.ok(children.every(c=>c.killed));
});

test('Lite automatically starts bundled editor, shell and configured CDP but not arbitrary external servers',async()=>{
 const registry={providers:new Map(),ensureDefaults(){},list:()=>[],register(){},probe:async()=>({ok:false})};
 const ids=['editor','shell','browser','external','off'];
 const started=[];
 const conn=automaticConnections({registry,env:{JACO_LITE:'1'},mcpHost:{status:()=>ids.map(id=>({id,status:'STOPPED',agentAccess:id==='off'?'off':'write',tools:[]})),start:async id=>{started.push(id);return [];}}});
 await conn.refresh();assert.deepEqual(started.sort(),['browser','editor','shell']);
});
