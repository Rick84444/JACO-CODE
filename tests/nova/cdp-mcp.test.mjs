import test from 'node:test';
import assert from 'node:assert/strict';
import {createCdpFacade} from '../../agents/cdp-bridge.mjs';
import {seerCompletion} from '../../agents/lib/seer-client.mjs';
const token='test-token-12345678901234567890';
async function fixture(run, upstream=async()=>({ok:true,json:async()=>({ok:true,observed:true,title:'fixture'})})) {
  const server=createCdpFacade({token,fetchImpl:upstream});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const rpc=(method,params={},headers={Authorization:'Bearer '+token})=>fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  try{await run(rpc,base);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('MCP rejects missing credentials before any upstream request',async()=>{
  await fixture(async rpc=>assert.equal((await rpc('tools/list',{},{})).status,401),async()=>{throw Error('MUST_NOT_CALL');});
});
test('MCP initializes, advertises tools and preserves observation',async()=>{
  await fixture(async rpc=>{
    assert.equal((await (await rpc('initialize',{protocolVersion:'2025-03-26'})).json()).result.serverInfo.name,'jaco-nova');
    const tools=(await (await rpc('tools/list')).json()).result.tools;
    assert.ok(tools.some(t=>t.name==='nova_observe'));
    assert.ok(!tools.some(t=>/eval|shell/.test(t.name)));
    const r=await (await rpc('tools/call',{name:'nova_observe'})).json();
    assert.equal(r.result.isError,false);assert.equal(JSON.parse(r.result.content[0].text).title,'fixture');
  });
});
test('MCP returns tool errors and never converts rejection to success',async()=>{
  await fixture(async rpc=>{
    const r=await (await rpc('tools/call',{name:'nova_observe'})).json();assert.equal(r.result.isError,true);
  },async()=>({ok:false,json:async()=>({ok:false,error:'ORIGIN_DENIED'})}));
});
test('MCP rejects browser-origin requests and invalid mutation arguments',async()=>{
  await fixture(async rpc=>{
    assert.equal((await rpc('tools/list',{}, {Authorization:'Bearer '+token,Origin:'https://untrusted.invalid'})).status,403);
    const r=await (await rpc('tools/call',{name:'nova_click',arguments:{selector:'button'}})).json();assert.equal(r.error.code,-32602);
  },async()=>{throw Error('MUST_NOT_CALL');});
});
test('SEER client preserves mission context and reports an unavailable model',async()=>{
  const text=await seerCompletion({system:'rules',user:'goal plus previous receipt',image:'fixture'},async(url,opts)=>{
    assert.ok(url.endsWith('/cortex/brain'));assert.equal(JSON.parse(opts.body).user,'goal plus previous receipt');
    return {ok:true,json:async()=>({ok:true,text:'{"complete":true}'})};
  });assert.equal(text,'{"complete":true}');
  await assert.rejects(seerCompletion({system:'rules',user:'goal'},async()=>({ok:false,json:async()=>({ok:false,error:'all_providers_failed'})})),/all_providers_failed/);
  await assert.rejects(
    seerCompletion({system:'rules',user:'goal'},async()=>({ok:false,status:503,json:async()=>({
      ok:false,
      error:'all_providers_failed',
      failures:[{provider:'llamacpp',code:'PROVIDER_HTTP_ERROR',status:400}],
    })})),
    /all_providers_failed \[llamacpp:PROVIDER_HTTP_ERROR:400\]/
  );
});
