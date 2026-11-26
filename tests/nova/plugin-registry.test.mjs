import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPluginRegistry} from '../../runtime/src/server/mcp/pluginRegistry.mjs';
const row=(name,status='active',isLatest=true)=>({server:{name,version:'1.0.0',description:'Example',remotes:[{type:'streamable-http',url:'https://untrusted.example/mcp',headers:[{value:'fixture-secret'}]}]},_meta:{'io.modelcontextprotocol.registry/official':{status,isLatest}}});
test('registry searches fixed public endpoint, filters active latest and never forwards remote credentials',async()=>{
  const r=await searchPluginRegistry('marketing & social',{fetchImpl:async(url,opts)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://registry.modelcontextprotocol.io');
    assert.equal(u.pathname,'/v0.1/servers');
    assert.equal(u.searchParams.get('search'),'marketing & social');
    assert.equal(u.searchParams.get('version'),'latest');
    assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.authorization,undefined);
    return Response.json({servers:[row('a'),row('b','deleted'),row('c','deprecated'),row('d','active',false)],metadata:{nextCursor:'private-cursor'}});
  }});
  assert.deepEqual(r.entries.map(e=>e.name),['a']);
  assert.equal(r.entries[0].state,'DISCOVERED_NOT_VERIFIED');
  assert.equal(r.hasMore,true);
  assert.doesNotMatch(JSON.stringify(r),/fixture-secret|untrusted\.example|private-cursor/);
});
test('invalid query and response fail closed',async()=>{
  for(const q of ['  ','ab','a'.repeat(101),'abc\nxyz'])await assert.rejects(searchPluginRegistry(q,{fetchImpl:()=>{throw Error('must not fetch');}}),/QUERY_INVALID/);
  await assert.rejects(searchPluginRegistry('marketing',{fetchImpl:async()=>Response.json({bad:true})}),/INVALID_RESPONSE/);
  await assert.rejects(searchPluginRegistry('marketing',{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}),/RESPONSE_LIMIT/);
  await assert.rejects(searchPluginRegistry('marketing',{fetchImpl:async()=>new Response('',{status:429})}),/HTTP_429/);
});
