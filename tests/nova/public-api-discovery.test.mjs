import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPublicApi} from '../../runtime/tools/jaco-public-api-discovery.mjs';
test('public metadata discovery sends no credentials and returns no document text',async()=>{
 const seen=[];const result=await discoverPublicApi('https://api.example.com/path?token=synthetic-secret',{fetchFn:async url=>{
  seen.push(url);return {url,content:url.endsWith('/openapi.json')?JSON.stringify({openapi:'3.0.1',paths:{'/jobs':{get:{},post:{}}},components:{securitySchemes:{x:{type:'apiKey',description:'synthetic-secret'}}},info:{description:'synthetic-secret'}}):'<html>not docs</html>'};
 }});
 assert.equal(result.state,'SPEC_OBSERVED');assert.equal(result.apiVerified,false);
 assert.equal(result.credentials,'NOT_ACQUIRED');assert.equal(result.probes[0].operationCounts.get,1);
 assert.deepEqual(result.probes[0].authenticationTypes,['apiKey']);
 assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);
 assert.equal(seen.length,5);assert.ok(seen.every(s=>new URL(s).origin==='https://api.example.com'&&!new URL(s).search));
});
test('cross-origin and truncated results cannot mark an API observed',async()=>{
 const result=await discoverPublicApi('https://api.example.com',{fetchFn:async url=>({url:url.endsWith('/openapi.json')?'https://other.example.com/openapi.json':url,truncated:true,content:'{"openapi":"3.0.0","paths":{}}'})});
 assert.equal(result.state,'NEEDS_CDP');
});
test('private/local or credential-bearing URLs fail before fetching',async()=>{
 let calls=0;for(const addr of ['http://example.com','https://127.0.0.1','https://user:pass@example.com','https://my.local'])await assert.rejects(discoverPublicApi(addr,{fetchFn:async()=>{calls++;}}));
 assert.equal(calls,0);
});
