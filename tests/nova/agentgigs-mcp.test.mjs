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

test('quote uses observed commission without claiming settlement',async()=>{
 const c=createAgentGigs({env,fetchImpl:async(url,opt)=>{assert.ok(url.endsWith('/earnings?calculate=5000'));assert.equal(opt.method,'GET');return json({calculator:{jobAmount:5000,commissionAmount:500,agentPayout:4500}});}});
 const q=await c.call('quote_economics',{price_cents:5000,cost_cents:500,hours:2,collection_probability:0.8});
 assert.equal(q.expected_contribution_cents,3100);assert.equal(q.expected_cents_per_hour,1550);assert.equal(q.settlement_verified,false);
 await assert.rejects(c.call('quote_economics',{price_cents:5000,cost_cents:0,hours:0,collection_probability:1}),/QUOTE_INPUT_INVALID/);
});
test('funded staged text delivery reads back metadata and cannot claim payment',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'jaco-gigs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let posted=0,files=[],status='in_progress',assigned=true;
 const c=createAgentGigs({env,stateDir:dir,fetchImpl:async(url,opt)=>{
 if(opt.method==='GET')return json({job:{id:job,status},isAssigned:assigned,myApplication:{id:'app',status:'funded'},deliverable_files:files});
 posted++;
 if(url.endsWith('/upload-deliverable')){const f=opt.body.get('file');assert.equal(await f.text(),'validated report');files=[{file_name:f.name,file_size:f.size,download_url:'private'}];return json({success:true});}
 assert.ok(url.endsWith('/submit'));status='delivered';return json({success:true});
 }});
 const args={job_id:job,filename:'report.md',content:'validated report'};
 assigned=false;await assert.rejects(c.call('stage_text_delivery',args),/FUNDED_ASSIGNMENT_REQUIRED/);assigned=true;
 const st=await c.call('stage_text_delivery',args);assert.equal(st.delivered,false);assert.equal(posted,0);
 await assert.rejects(c.call('stage_text_delivery',{...args,filename:'../report.md'}),/ARTIFACT_INVALID/);
 const d=await c.call('deliver_staged_text',{job_id:job,artifact_sha256:st.artifact_sha256,notes:'Report complete'});
 assert.equal(d.submitted,true);assert.equal(d.status,'delivered');assert.equal(d.settlement_verified,false);assert.equal(posted,2);
 status='in_progress';await assert.rejects(c.call('deliver_staged_text',{job_id:job,artifact_sha256:st.artifact_sha256,notes:'Report complete'}),/DELIVERY_EXISTS_RECONCILE/);assert.equal(posted,2);
});
test('ambiguous upload cannot replay on adapter restart',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'jaco-gigs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let writes=0;const fetchImpl=async(url,opt)=>{if(opt.method==='GET')return json({job:{id:job,status:'in_progress'},isAssigned:true,myApplication:{status:'funded'},deliverable_files:[]});writes++;throw Error('timeout');};
 const c=createAgentGigs({env,stateDir:dir,fetchImpl});const st=await c.call('stage_text_delivery',{job_id:job,filename:'report.txt',content:'report'});
 const args={job_id:job,artifact_sha256:st.artifact_sha256,notes:'Reviewed'};
 await assert.rejects(c.call('deliver_staged_text',args),/OUTCOME_UNKNOWN/);
 const restarted=createAgentGigs({env,stateDir:dir,fetchImpl});
 await assert.rejects(restarted.call('deliver_staged_text',args),/ALREADY_ATTEMPTED/);assert.equal(writes,1);
});
