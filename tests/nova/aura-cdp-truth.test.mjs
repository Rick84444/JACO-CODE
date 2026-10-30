import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCdpBrowser, createBrowserHealthMonitor, server as novaServer } from '../../agents/nova-bridge.mjs';
import { createCdpFacade } from '../../agents/cdp-bridge.mjs';

const TOKEN = 'test-token-12345678901234567890123';
const PAGE = { id:'p1', type:'page', url:'about:blank',
  webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/p1' };
const upstream = body => async (_url,opts) => {
  assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
  return { ok:true, status:200, json:async()=>body };
};
async function requestHealth(upstreamFetch, token=TOKEN) {
  const facade = createCdpFacade({token,fetchImpl:upstreamFetch});
  await new Promise(resolve=>facade.listen(0,'127.0.0.1',resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+facade.address().port+'/health');
    return { http:response.status, body:await response.json() };
  } finally {
    facade.closeAllConnections();
    await new Promise(resolve=>facade.close(resolve));
  }
}
test('browser health cannot mutate or open a tab; real socket evaluation required',async()=>{
  const calls=[];
  const result=await probeCdpBrowser({
    listTabs:async()=>[PAGE],
    sessionFactory:()=>({
      ready:async(ms)=>{ assert.equal(ms,5000); calls.push('open'); },
      send:async(method,params)=>{ calls.push(method);
        assert.deepEqual(params,{expression:'1+1',returnByValue:true});
        return {result:{value:2}}; },
      close:()=>calls.push('close'),
    }),
  });
  assert.equal(result.ok,true);
  assert.equal(result.browserVerified,true);
  assert.deepEqual(calls,['open','Runtime.evaluate','close']);
  assert.equal(novaServer.listening,false,'import must not start another service');
});
test('missing or remote WebSocket targets fail closed without a connection attempt',async()=>{
  const spy=()=>assert.fail('must not connect');
  assert.equal((await probeCdpBrowser({listTabs:async()=>[],sessionFactory:spy})).error,'CDP_NO_DEBUGGABLE_PAGE');
  assert.equal((await probeCdpBrowser({listTabs:async()=>({}),sessionFactory:spy})).error,'CDP_TARGET_LIST_INVALID');
  const remote={...PAGE,webSocketDebuggerUrl:'ws://evil.example.invalid/devtools/page/p1'};
  assert.equal((await probeCdpBrowser({listTabs:async()=>[remote],sessionFactory:spy})).ok,false);
  assert.equal((await probeCdpBrowser({listTabs:async()=>[PAGE],selectedId:'stale',sessionFactory:spy})).error,'CDP_PINNED_TARGET_UNAVAILABLE');
});
test('failed evaluation, WebSocket refusal and cleanup cannot become readiness',async()=>{
  let closed=0;
  const bad=await probeCdpBrowser({listTabs:async()=>[PAGE],sessionFactory:()=>({
    ready:async()=>{},send:async()=>({result:{value:3}}),close:()=>closed++,
  })});
  assert.equal(bad.error,'CDP_EVALUATION_UNVERIFIED');
  const refused=await probeCdpBrowser({listTabs:async()=>[PAGE],sessionFactory:()=>({
    ready:async()=>{throw Error('CDP_WEBSOCKET_TIMEOUT');},
    send:async()=>assert.fail('must not send'),
    close:()=>closed++,
  })});
  assert.equal(refused.ok,false);
  assert.equal(refused.error,'CDP_CONNECTION_FAILED');
  assert.equal(closed,2);
});
test('browser monitor never treats pending or expired receipts as READY',async()=>{
  let clock=1000, response;
  const promise=new Promise(resolve=>{response=resolve;});
  const monitor=createBrowserHealthMonitor(()=>promise,{clock:()=>clock,refreshMs:1000,validityMs:3000});
  assert.equal(monitor.status().ok,false);
  response({ok:true,state:'READY',browserVerified:true});
  await monitor.settle();
  assert.equal(monitor.status().ok,true);
  clock += 4000;
  assert.equal(monitor.status().ok,false);
});
test('MCP facade requires recent browser and Workplace evidence, not legacy HTTP 200',async()=>{
  const old=await requestHealth(upstream({ok:true,service:'nova-bridge',browserVerified:false}));
  assert.equal(old.http,503);
  assert.equal(old.body.browserVerified,false);
  const legacy=await requestHealth(upstream({ok:true,state:'READY',browserVerified:true}));
  assert.equal(legacy.http,503,'missing attestation age must fail closed');
  const stale=await requestHealth(upstream({ok:true,state:'READY',browserVerified:true,
    verifiedAt:new Date(Date.now()-30000).toISOString(),verificationAgeMs:30000}));
  assert.equal(stale.http,503);
  const good=await requestHealth(upstream({ok:true,state:'READY',browserVerified:true,
    verifiedAt:new Date().toISOString(),verificationAgeMs:0}));
  assert.equal(good.http,200);
  assert.equal(good.body.browserVerified,true);
  assert.equal(good.body.state,'READY');
});
test('unreachable Nova, tokenless bridge and no-browser gates remain HTTP 503',async()=>{
  const missing=await requestHealth(async()=>{throw Error('ECONNREFUSED')});
  assert.equal(missing.http,503);
  assert.equal(missing.body.error,'CDP_BRIDGE_UNREACHABLE');
  const blocked=await requestHealth(async()=>assert.fail('never called'), 'short');
  assert.equal(blocked.http,503);
  assert.equal(blocked.body.error,'GATEWAY_TOKEN_MISSING');
  const noBrowser=await requestHealth(async()=>({ok:false,status:503,json:async()=>({
    ok:false,error:'CDP_NO_DEBUGGABLE_PAGE',
  })}));
  assert.equal(noBrowser.http,503);
  assert.equal(noBrowser.body.error,'CDP_NO_DEBUGGABLE_PAGE');
});
