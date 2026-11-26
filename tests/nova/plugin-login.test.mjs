import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginLogin} from '../../runtime/src/server/connected/pluginLogin.mjs';
import {validateServerEntry,loadServerConfig} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

const base={transport:'http',url:'https://mcp.render.com/mcp',tokenEnv:'RENDER_API_KEY',agentAccess:'read',allowOpenLogin:true};
function fixture(){
  let def={...base},status={id:'render',status:'STOPPED',credentialConfigured:false},time=1000;
  const calls=[];
  const host={servers:()=>({render:def}),status:()=>[status]};
  const open=createPluginLogin({host,platform:'linux',env:{PATH:'/bin',HOME:'/h',RENDER_API_KEY:'fixture-secret'},now:()=>time,execute:async(...args)=>{calls.push(args);}});
  return {open,calls,setDef:d=>{def=d;},setStatus:s=>{status=s;},advance:()=>{time+=60001;}};
}
test('opening is tied to explicit operator approval, exact endpoint, and observed auth need',async()=>{
  const f=fixture();
  f.setDef({...base,allowOpenLogin:false});
  await assert.rejects(f.open('render'),/PLUGIN_LOGIN_NOT_APPROVED/);
  f.setDef({...base,url:'https://example.org/mcp'});
  await assert.rejects(f.open('render'),/PLUGIN_LOGIN_NOT_APPROVED/);
  f.setDef({...base,agentAccess:'off'});
  await assert.rejects(f.open('render'),/PLUGIN_LOGIN_NOT_APPROVED/);
  f.setDef(base);
  f.setStatus({id:'render',status:'FAILED',credentialConfigured:true,error:'MCP_TRANSPORT_DNS'});
  await assert.rejects(f.open('render'),/PLUGIN_AUTH_NEED_NOT_OBSERVED/);
  assert.equal(f.calls.length,0);
  f.setStatus({id:'render',status:'FAILED',credentialConfigured:true,error:'MCP_AUTH_REQUIRED'});
  const result=await f.open('render');
  assert.equal(result.state,'BROWSER_OPEN_REQUEST_ACCEPTED');
  assert.equal(result.authenticated,false);
  assert.equal(result.humanConsentRequired,true);
  assert.deepEqual(f.calls[0].slice(0,2),['xdg-open',['https://dashboard.render.com/']]);
  assert.equal(f.calls[0][2].shell,false);
  assert.equal(f.calls[0][2].env.RENDER_API_KEY,undefined);
  await assert.rejects(f.open('render'),/PLUGIN_LOGIN_RATE_LIMITED/);
  f.advance();
  f.setStatus({id:'render',status:'READY',credentialConfigured:true});
  assert.equal((await f.open('render')).state,'ALREADY_CONNECTED');
  assert.equal(f.calls.length,1);
});
test('approval persists in canonical config and is revoked by removing the opt-in',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-plugin-test-'));
  try{
    const file=path.join(dir,'servers.json');
    const config={configFile:file,repoRoot:dir,runtimeRoot:dir};
    for(const enabled of [true,false]){
      fs.writeFileSync(file,JSON.stringify({servers:{render:validateServerEntry('render',{...base,allowOpenLogin:enabled})}}));
      assert.equal(loadServerConfig(config).render.allowOpenLogin===true,enabled);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('browser failure never produces a success receipt or diagnostic leak',async()=>{
  const open=createPluginLogin({host:{servers:()=>({render:base}),status:()=>[{id:'render',status:'FAILED',credentialConfigured:false}]},platform:'win32',execute:async()=>{throw Error('private diagnostic');}});
  await assert.rejects(open('render'),e=>e.message==='PLUGIN_BROWSER_OPEN_FAILED');
});
