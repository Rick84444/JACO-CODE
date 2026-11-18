import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createAgentGigs} from '../../runtime/tools/jaco-agentgigs-mcp.mjs';
const job='12345678-1234-1234-1234-123456789abc';
const proposal={job_id:job,proposed_price:1000,message:'Verified deliverable proposal',estimated_delivery:'24 hours'};
const json=x=>new Response(JSON.stringify(x),{status:200});
const env={JACO_AGENTGIGS_API_KEY:'age_test',JACO_AGENTGIGS_ENABLE_WRITES:'1'};
test('writes hidden and denied unless explicitly activated',async()=>{
 let requests=0;const c=createAgentGigs({env:{JACO_AGENTGIGS_API_KEY:'age_test'},fetchImpl:async()=>{requests++;return json({});}});
 assert.equal(c.tools().some(t=>t.name==='apply'),false);
 await assert.rejects(c.call('apply',proposal),/WRITE_MANDATE_REQUIRED/);assert.equal(requests,0);
});
test('apply verifies actual application and never replays',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'jaco-gigs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let writes=0;const c=createAgentGigs({env,stateDir:dir,fetchImpl:async(url,opt)=>{
 assert.equal(new URL(url).origin,'https://www.agentgigs.io');assert.equal(opt.redirect,'error');assert.equal(opt.headers['X-API-Key'],'age_test');
 if(url.endsWith('/available'))return json({jobs:[{id:job,budget_min:500,budget_max:1500}]});
 if(opt.method==='POST'){writes++;return json({success:true});}
 return json({job:{id:job},myApplication:{id:'application',proposed_price:1000,status:'pending'}});
 }});
 assert.equal((await c.call('apply',proposal)).submitted,true);assert.equal(writes,2);
 await assert.rejects(c.call('apply',proposal),/ALREADY_ATTEMPTED/);assert.equal(writes,2);
});
test('unknown outcome locks application, no second mutation',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'jaco-gigs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let writes=0;const c=createAgentGigs({env,stateDir:dir,fetchImpl:async(url,opt)=>{
 if(url.endsWith('/available'))return json({jobs:[{id:job,budget_min:500,budget_max:1500}]});
 if(opt.method==='POST'){writes++;throw Error('timeout');}
 return json({});
 }});
 await assert.rejects(c.call('apply',proposal),/OUTCOME_UNKNOWN/);
 await assert.rejects(c.call('apply',proposal),/ALREADY_ATTEMPTED/);assert.equal(writes,1);
});

test('durable attempt IDs survive adapter restart, including ambiguous writes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'jaco-gigs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let calls=0;
 const c=createAgentGigs({env,stateDir:dir,fetchImpl:async(url,opt)=>{
 if(url.endsWith('/available'))return json({jobs:[{id:job,budget_min:500,budget_max:1500}]});
 calls++;throw Error('timeout');
 }});
 assert.deepEqual(await c.call('list_attempted'),{job_ids:[],truncated:false});
 await assert.rejects(c.call('apply',proposal),/OUTCOME_UNKNOWN/);
 const reopened=createAgentGigs({stateDir:dir,env:{},fetchImpl:async()=>{throw Error('network should not be called');}});
 assert.deepEqual(await reopened.call('list_attempted'),{job_ids:[job],truncated:false});assert.equal(calls,1);
});

test('own application history is read-only and strips third-party data',async()=>{
 const c=createAgentGigs({env:{JACO_AGENTGIGS_API_KEY:'age_test'},fetchImpl:async(url,opt)=>{assert.ok(url.endsWith('/api/agent/applications?limit=50'));assert.equal(opt.method,'GET');return json({applications:[{job_id:job,status:'funded',proposed_price:1000,job:{status:'assigned',description:'private',download_url:'private'}}],counts:{total:1}});}});
 assert.deepEqual(await c.call('list_applications'),{applications:[{job_id:job,status:'funded',proposed_price:1000,job_status:'assigned'}],count:1,truncated:false});
});
