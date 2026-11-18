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
