import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemControl } from '../src/system-control.mjs';

function fixture({coreUp=true,wpUp=true,wpState='RUNNING',novaState='RUNNING',wpIdentity='JACO Workplace',url='http://127.0.0.1:2995'}={}) {
  const calls=[];
  const core={request:async(path,opts)=>{
    calls.push(['core',path]);assert.equal(path,'/api/runtime/identity');
    assert.ok(opts.signal);if(!coreUp)throw Error('CORE_DOWN');
    return {success:true,releaseId:'jaco-code'};
  }};
  const fetchImpl=async (uri,opts)=>{
    calls.push(['workplace',uri]);assert.equal(uri,url+'/health');
    assert.equal(opts.method,'GET');
    if(!wpUp)throw Error('WP_DOWN');
    return {ok:true,json:async()=>({
      product:wpIdentity,
      supervisedAgents:{state:wpState,nova:{state:novaState}}
    })};
  };
  const sys = new SystemControl({jacoctl:'/unused',repoRoot:'/unused',core,workplaceUrl:url,fetchImpl});
  return {sys,calls};
}

test('health reports READY only after independent real Core and Workplace/Nova observations',async()=>{
  const {sys,calls}=fixture();
  const r=await sys.health();
  assert.deepEqual(r,{schema:'jaco.service-health/v1',status:'READY',core:{up:true},workplace:{up:true,state:'RUNNING',novaState:'RUNNING'},aura:{state:'NOT_INDEPENDENTLY_PROBED'}});
  assert.equal(calls.length,2);
});
test('health reports degradation when Workplace is unavailable',async()=>{
  const r=await fixture({wpUp:false}).sys.health();
  assert.equal(r.status,'DEGRADED');
  assert.equal(r.core.up,true);
  assert.equal(r.workplace.up,false);
  assert.equal(r.workplace.state,'DOWN');
});
test('health reports DOWN when neither Core nor Workplace responds',async()=>{
  const r=await fixture({coreUp:false,wpUp:false}).sys.health();
  assert.equal(r.status,'DOWN');
});
test('health rejects spoofed Workplace identity',async()=>{
  const r=await fixture({wpIdentity:'unrelated-application'}).sys.health();
  assert.equal(r.workplace.up,false);
  assert.equal(r.status,'DEGRADED');
});
test('health fails closed when a configured Workplace target is not loopback',async()=>{
  const {sys,calls}=fixture({url:'https://external.example'});
  await assert.rejects(sys.health(),/JACO_HEALTH_WORKPLACE_MUST_BE_LOOPBACK/);
  assert.deepEqual(calls,[]);
});
