import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { createBrowserRouter } from '../../runtime/src/server/browser/router.ts';
import { createDesktopRouter } from '../../runtime/src/server/desktop/router.ts';
import { AutonomyMandateStore } from '../../runtime/src/server/autonomy/autonomyMandate.ts';

const permit = (_req,_res,next) => next();

async function fixture(t, create) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-direct-actuator-'));
  const mandates=new AutonomyMandateStore(root);
  const mandate=mandates.get('operator-level5-default');
  assert.ok(mandate);
  mandates.sign(mandate.id);
  const app=express();
  app.use(express.json());
  const state=create({root,mandates,app});
  const http=app.listen(0,'127.0.0.1');
  await once(http,'listening');
  t.after(()=>{http.close(); fs.rmSync(root,{recursive:true,force:true});});
  const address=http.address();
  const url='http://127.0.0.1:'+address.port;
  return {...state,url,mandates,root};
}

const post=async (url,body)=>{
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
};

test('direct CDP action renews a signed browser grant, then obeys live revocation',async t=>{
  const grants=[];
  let executions=0;
  const env=await fixture(t,({root,mandates,app})=>{
    const {router,sessions}=createBrowserRouter(root,permit,undefined,()=>mandates);
    sessions.getClient=()=>({
      configureGrant(value){grants.push(value);return value;},
      async executeVerified(){executions++;return {verified:true,verification:{level:'SEMANTIC'}};}
    });
    app.use('/browser',router);
    return {};
  });
  const action={type:'navigate',url:'https://example.org'};
  const first=await post(env.url+'/browser/action',action);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(executions,1);
  assert.equal(grants[0].enabled,true);
  assert.equal(grants[0].scope_mode,'broad_web');
  assert.ok(Date.parse(grants[0].expires_at)>Date.now());
  const prefs=path.join(env.root,'.jaco','state','capabilities.json');
  fs.writeFileSync(prefs,JSON.stringify({schema:'jaco.capabilities/v1',disabledTasks:['browser-survey-site']}));
  const switchedOff=await post(env.url+'/browser/action',action);
  assert.equal(switchedOff.status,403);
  assert.equal(executions,1,'GUI untick stops browser immediately');
  fs.unlinkSync(prefs);
  env.mandates.revoke('operator-level5-default');
  const blocked=await post(env.url+'/browser/action',action);
  assert.equal(blocked.status,403);
  assert.equal(executions,1,'revocation prevents next tool dispatch');
});

test('direct desktop UIA action uses current signed scope and stops after revoke',async t=>{
  const grants=[];
  let executions=0;
  const env=await fixture(t,({root,mandates,app})=>{
    const fakeDesktop={
      configureGrant(value){grants.push(value);return value;},
      async executeVerified(){executions++;return {verified:true};}
    };
    app.use('/desktop',createDesktopRouter(root,root,permit,undefined,fakeDesktop,mandates));
    return {};
  });
  const action={type:'invoke',selector:{name:'Open'}};
  const first=await post(env.url+'/desktop/action',action);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(executions,1);
  assert.equal(grants[0].allow_invoke,true);
  assert.ok(grants[0].allowed_processes.length>0,'existing safe process defaults');
  const prefs=path.join(env.root,'.jaco','state','capabilities.json');
  fs.writeFileSync(prefs,JSON.stringify({schema:'jaco.capabilities/v1',disabledTasks:['desktop-invoke']}));
  const switchedOff=await post(env.url+'/desktop/action',action);
  assert.equal(switchedOff.status,403);
  assert.equal(executions,1,'GUI untick stops desktop immediately');
  fs.unlinkSync(prefs);
  env.mandates.revoke('operator-level5-default');
  const blocked=await post(env.url+'/desktop/action',action);
  assert.equal(blocked.status,403);
  assert.equal(executions,1);
});
