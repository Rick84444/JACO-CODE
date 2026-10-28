import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { ContinuumRuntime } from '../../src/server/continuum/continuumRuntime.mjs';

const roots=[]; const servers=[]; const passed=[];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){await fn();passed.push(name);console.log(`PASS ${name}`);}
function root(prefix='jaco-021-'){const r=fs.mkdtempSync(path.join(os.tmpdir(),prefix));roots.push(r);return r;}
class NullSessions {getClient(){return null;} snapshot(){return {attached:false,cdpPort:9222};} async targets(){return [];} async attach(){throw new Error('NO_BROWSER');} async detach(){} }
async function fakeProvider({status=200,text='ok'}={}){const srv=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;res.setHeader('content-type','application/json');if(status!==200){res.statusCode=status;return res.end(JSON.stringify({error:'forced failure'}));}if(req.url?.endsWith('/chat/completions'))return res.end(JSON.stringify({id:'resp-test',model:'fake-model',choices:[{message:{content:text}}],usage:{prompt_tokens:4,completion_tokens:2}}));if(req.url?.endsWith('/api/generate'))return res.end(JSON.stringify({response:text,done:true,prompt_eval_count:4,eval_count:2}));res.statusCode=404;res.end(JSON.stringify({error:'not found'}));});srv.listen(0,'127.0.0.1');await once(srv,'listening');servers.push(srv);return `http://127.0.0.1:${srv.address().port}`;}

try{
  await test('provider-neutral.failover-without-named-fallback',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    for(const p of rt.providers.list())rt.providers.remove(p.id,'test');
    const bad=await fakeProvider({status:500}), good=await fakeProvider({status:200,text:'provider two succeeded'});
    rt.providers.register({id:'candidate-a',protocol:'openai-chat',baseUrl:bad,model:'a',local:true,priority:100,capabilities:['reasoning','text']});
    rt.providers.register({id:'candidate-b',protocol:'openai-chat',baseUrl:good,model:'b',local:true,priority:0,capabilities:['reasoning','text']});
    const out=await rt.models.reason({prompt:'test',requiredCapabilities:['reasoning']});
    assert.equal(out.providerId,'candidate-b');assert.equal(out.text,'provider two succeeded');
    const src=fs.readFileSync(path.join(process.cwd(),'src/server/continuum/modelRouter.mjs'),'utf8');
    assert.equal(/fallback\s*=\s*['"](?:gemini|lm.?studio)/i.test(src),false);
  });

  await test('evidence.referential-integrity-critical-transitions',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    const m=rt.missions.create({objective:'Integrity mission',state:'ACTIVE'}),c=rt.commitments.create({missionId:m.id,title:'Do'});
    rt.commitments.transition(c.id,'ACCEPTED');rt.commitments.transition(c.id,'ACTIVE');rt.commitments.transition(c.id,'VERIFYING');
    assert.throws(()=>rt.commitments.transition(c.id,'FULFILLED',{evidenceRefs:['missing-evidence']}),/not found/);
    assert.throws(()=>rt.economic.recordRevenue({amountUsd:5,source:'test',verified:true,evidenceRef:'missing-evidence'}),/not found/);
    const wrong=rt.evidence.recordInternal({kind:'test',claim:'not payment',verified:true,verificationMethod:'test'});
    assert.throws(()=>rt.economic.recordRevenue({amountUsd:5,source:'test',verified:true,evidenceRef:wrong.id}),/kind not allowed/);
    const pay=rt.evidence.recordInternal({kind:'payment-settlement',claim:'external settlement observed',verified:true,verificationMethod:'test'});
    rt.economic.recordRevenue({amountUsd:5,source:'test',verified:true,evidenceRef:pay.id});assert.equal(rt.economic.snapshot().state.revenueUsd,5);
  });

  await test('review.reward-requires-independent-validation',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    rt.hub.registerAgent({id:'reviewer',capabilities:['REVIEW']});rt.hub.registerAgent({id:'target',capabilities:['MODEL_REASON']});rt.hub.registerAgent({id:'validator',capabilities:['REVIEW']});
    const original=rt.evidence.recordInternal({kind:'task-output',claim:'output',verified:true,verificationMethod:'test'});
    const rv=rt.reviews.submit({reviewerAgentId:'reviewer',targetAgentId:'target',targetId:'t1',kind:'CODE_QUALITY',severity:'HIGH',claim:'Concrete defect',evidenceRefs:[original.id]});
    assert.throws(()=>rt.reviews.validate(rv.id,{validatorAgentId:'reviewer',evidenceRefs:[original.id]}),/cannot validate own/);
    assert.throws(()=>rt.reviews.validate(rv.id,{validatorAgentId:'validator',evidenceRefs:[original.id]}),/independent validation requires new/);
    const independent=rt.evidence.recordInternal({kind:'review-validation',claim:'Independent reproduction',verified:true,verificationMethod:'independent test'});
    const valid=rt.reviews.validate(rv.id,{validatorAgentId:'validator',evidenceRefs:[independent.id],valid:true});
    assert.equal(valid.status,'VALIDATED');assert.ok(valid.rewardCredits>0);assert.ok(rt.reviews.agentScore('reviewer').card.rewardCredits>0);
    const dup=rt.reviews.submit({reviewerAgentId:'reviewer',targetAgentId:'target',targetId:'t1',kind:'CODE_QUALITY',severity:'HIGH',claim:'Concrete defect',evidenceRefs:[original.id]});assert.equal(dup.status,'DUPLICATE');
  });

  await test('review.self-reward-is-lower-than-peer-reward',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    rt.hub.registerAgent({id:'a',capabilities:['REVIEW']});rt.hub.registerAgent({id:'b',capabilities:['REVIEW']});rt.hub.registerAgent({id:'v',capabilities:['REVIEW']});
    const e1=rt.evidence.recordInternal({kind:'task-output',claim:'x1',verified:true,verificationMethod:'test'}),e2=rt.evidence.recordInternal({kind:'review-validation',claim:'v1',verified:true,verificationMethod:'test'});
    const self=rt.reviews.submit({reviewerAgentId:'a',targetAgentId:'a',targetId:'self1',kind:'SELF_ERROR',claim:'self defect',evidenceRefs:[e1.id]});const sv=rt.reviews.validate(self.id,{validatorAgentId:'v',evidenceRefs:[e2.id]});
    const e3=rt.evidence.recordInternal({kind:'task-output',claim:'x2',verified:true,verificationMethod:'test'}),e4=rt.evidence.recordInternal({kind:'review-validation',claim:'v2',verified:true,verificationMethod:'test'});
    const peer=rt.reviews.submit({reviewerAgentId:'b',targetAgentId:'a',targetId:'peer1',kind:'PEER_ERROR',claim:'peer defect',evidenceRefs:[e3.id]});const pv=rt.reviews.validate(peer.id,{validatorAgentId:'v',evidenceRefs:[e4.id]});assert.ok(pv.rewardCredits>sv.rewardCredits);
  });

  await test('review.idle-stall-detection-rewards-real-finding',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    rt.hub.registerAgent({id:'idle-agent',capabilities:['MODEL_REASON']});rt.hub.createTask({title:'Runnable',kind:'MODEL_REASON',requirements:['MODEL_REASON']});await sleep(5);
    const findings=rt.reviews.auditIdle('jaco-seer',{staleAfterMs:1});assert.ok(findings.some(x=>x.targetAgentId==='idle-agent'&&x.kind==='IDLE_STALL'&&x.status==='VALIDATED'));
  });

  await test('runtime.multi-agent-selection-uses-capability-and-reputation',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    rt.hub.registerAgent({id:'weak',role:'worker',capabilities:['SPECIAL']});rt.hub.registerAgent({id:'strong',role:'worker',capabilities:['SPECIAL']});
    for(let i=0;i<8;i++)rt.reviews.recordExecution('strong',{success:true,quality:1});for(let i=0;i<5;i++)rt.reviews.recordExecution('weak',{success:false,quality:0});
    const task=rt.hub.createTask({title:'special',kind:'SPECIAL',requirements:['SPECIAL']});const selected=rt.hub.selectAgentForTask(task,{scoreFn:id=>rt.reviews.agentScore(id)});assert.equal(selected.agent.id,'strong');
  });

  await test('scheduler.self-review-is-bound-to-original-agent-and-peer-review-excludes-it',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});rt.models.reason=async()=>({providerId:'fake',provider:'fake',model:'fake',text:'{"finding":null}',usage:null,costUsd:0});
    rt.scheduler.state.enabled=true;
    const self=rt.hub.createTask({title:'self',kind:'REVIEW_SELF',requirements:['REVIEW'],payload:{targetAgentId:'jaco-forge',targetTaskId:'origin',evidenceRefs:[]}});
    // Review executor requires at least one original evidence reference.
    const ev=rt.evidence.recordInternal({kind:'task-output',claim:'origin',verified:true,verificationMethod:'test'});rt.hub.state.tasks[self.id].payload.evidenceRefs=[ev.id];rt.hub['#save']?.();
    // public persistence isn't exposed; direct state is enough for this runtime tick.
    await rt.scheduler.tick();assert.equal(rt.hub.listTasks().find(t=>t.id===self.id).assignedAgentId,'jaco-forge');
    const peer=rt.hub.createTask({title:'peer',kind:'REVIEW_PEER',requirements:['REVIEW'],payload:{targetAgentId:'jaco-forge',targetTaskId:'origin2',evidenceRefs:[ev.id]}});await rt.scheduler.tick();assert.notEqual(rt.hub.listTasks().find(t=>t.id===peer.id).assignedAgentId,'jaco-forge');
  });

  await test('deliberation.allows-time-extension-and-no-conclusion',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});
    const d=rt.deliberations.create({question:'Will condition X occur?',declaredGoal:'Minimize forecast error',minimumIndependentViews:2,uncertaintyThreshold:0.1,maxExtensions:2});
    rt.deliberations.addPosition(d.id,{agentId:'a',claim:'maybe',confidence:0.45,assumptions:['A'],declaredGoal:'Minimize forecast error'});rt.deliberations.addPosition(d.id,{agentId:'b',claim:'maybe not',confidence:0.55,assumptions:['B'],declaredGoal:'Different goal'});
    const ex=rt.deliberations.extend(d.id,{reason:'material uncertainty',additionalMs:60_000});assert.equal(ex.status,'TIME_EXTENDED');const out=rt.deliberations.conclude(d.id,{forceNoConclusion:true});assert.equal(out.status,'NO_CONCLUSION');assert.equal(rt.deliberations.goalIntegrity(d.id).status,'CHALLENGE_REQUIRED');
  });

  await test('soft-sandbox.is-real-filesystem-and-reversible-agent-restriction',async()=>{
    const r=root();fs.mkdirSync(path.join(r,'src'),{recursive:true});fs.writeFileSync(path.join(r,'src','sample.js'),'export const x=1;\n');const rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});rt.hub.registerAgent({id:'risky',capabilities:['SANDBOX_ANALYSIS']});
    const s=rt.sandboxes.create({agentId:'risky',reason:'test',sourcePaths:['src/sample.js']});assert.ok(fs.existsSync(path.join(s.filesystemRoot,'src','sample.js')));assert.equal(rt.hub.listAgents().find(a=>a.id==='risky').executionMode,'SANDBOX_ONLY');rt.sandboxes.write(s.id,'src/sample.js','export const x=2;\n');assert.equal(rt.sandboxes.diff(s.id)[0].status,'MODIFIED');const snap=rt.sandboxes.snapshot(s.id);rt.evidence.assertRefs([snap.evidenceRef],{verified:true,kinds:['sandbox-snapshot']});rt.sandboxes.close(s.id);assert.equal(rt.hub.listAgents().find(a=>a.id==='risky').executionMode,'NORMAL');
  });

  await test('risk.soft-sandbox-preserves-agent-instead-of-removing-it',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});rt.hub.registerAgent({id:'agent-risk',capabilities:['MODEL_REASON']});rt.hub.registerAgent({id:'critic',capabilities:['REVIEW']});rt.hub.registerAgent({id:'verifier-x',capabilities:['REVIEW']});
    const a=rt.evidence.recordInternal({kind:'task-output',claim:'unsafe code evidence',verified:true,verificationMethod:'test'}),b=rt.evidence.recordInternal({kind:'review-validation',claim:'independent reproduction',verified:true,verificationMethod:'test'});const rv=rt.reviews.submit({reviewerAgentId:'critic',targetAgentId:'agent-risk',targetId:'bad-task',kind:'RISK_FOUND',severity:'HIGH',claim:'verified unsafe behavior',evidenceRefs:[a.id]});rt.reviews.validate(rv.id,{validatorAgentId:'verifier-x',evidenceRefs:[b.id]});const agent=rt.hub.listAgents().find(x=>x.id==='agent-risk');assert.ok(agent);assert.equal(agent.executionMode,'SANDBOX_ONLY');assert.ok(agent.sandboxId);assert.ok(fs.existsSync(rt.sandboxes.get(agent.sandboxId).filesystemRoot));
  });

  await test('future.rolling-90-day-versioned-calibrated-synthetic-window',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});const observed=rt.evidence.recordInternal({kind:'observation',claim:'current observed fact',verified:true,verificationMethod:'test'});rt.future.ingestObservation({source:'test',variables:{demand:10},evidenceRefs:[observed.id]});const resolutionAt=new Date(Date.now()+10*24*3600_000).toISOString();const f=rt.future.forecast({question:'Demand grows?',agentId:'f1',resolutionAt,probabilities:{YES:0.6,NO:0.4},rationale:'base',evidenceRefs:[observed.id]});rt.future.updateForecast(f.id,{agentId:'f1',probabilities:{YES:0.7,NO:0.3},rationale:'update',evidenceRefs:[observed.id]});assert.equal(rt.future.getForecast(f.id).versions.length,2);const resolveEv=rt.evidence.recordInternal({kind:'forecast-resolution',claim:'outcome observed',verified:true,verificationMethod:'test'});const resolved=rt.future.resolve(f.id,{outcome:'YES',evidenceRefs:[resolveEv.id]});assert.ok(resolved.brier>=0&&resolved.brier<=2);assert.equal(rt.future.calibration('f1').count,1);const scenario=rt.future.createScenario({name:'90-day test',assumptions:['independence approximation'],evidenceRefs:[observed.id],events:[{id:'e1',label:'demand shock',probability:0.5,impact:{revenue:10}}]});const sim=rt.future.simulate(scenario.id,{runs:500,seed:'fixed'});assert.equal(sim.synthetic,true);assert.equal(rt.future.snapshot().horizonDays,90);assert.ok(Date.parse(rt.future.snapshot().window.through)-Date.parse(rt.future.snapshot().window.asOf)>=89*24*3600_000);
  });

  await test('future.calibration-weights-agent-aggregation',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});rt.reviews.recordForecastScore('good',0.1);rt.reviews.recordForecastScore('bad',1.8);const resolutionAt=new Date(Date.now()+5*24*3600_000).toISOString();rt.future.forecast({question:'Shared Q',agentId:'good',resolutionAt,probabilities:{YES:0.9,NO:0.1}});rt.future.forecast({question:'Shared Q',agentId:'bad',resolutionAt,probabilities:{YES:0.1,NO:0.9}});const agg=rt.future.aggregateForecasts('Shared Q')[0];assert.ok(agg.probabilities.YES>0.5);
  });

  await test('a2a.trust-registry-requires-observed-card-evidence',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});assert.throws(()=>rt.a2aTrust.observe('https://peer.example',{name:'Peer',skills:[]},'missing'),/not found/);const cardEv=rt.evidence.recordInternal({kind:'a2a-agent-card',claim:'card observed',verified:true,verificationMethod:'HTTP 200 + hash'});const peer=rt.a2aTrust.observe('https://peer.example',{name:'Peer',version:'1.0',skills:[{id:'research',name:'Research',tags:['deep']}],capabilities:{extensions:[]},securitySchemes:{}},cardEv.id);assert.equal(peer.https,true);assert.equal(rt.a2aTrust.match({skillId:'research'})[0].id,peer.id);const outEv=rt.evidence.recordInternal({kind:'a2a-result',claim:'real result',verified:true,verificationMethod:'receipt'});const scored=rt.a2aTrust.markOutcome(peer.id,{success:true,evidenceRefs:[outEv.id]});assert.ok(scored.trustScore>0);
  });

  await test('scheduler.a2a-inbound-has-eligible-worker',async()=>{
    const r=root(),rt=new ContinuumRuntime({workspaceRoot:r,browserSessions:new NullSessions()});const task=rt.hub.createTask({title:'A2A',kind:'A2A_INBOUND',requirements:['A2A_INBOUND'],payload:{message:{parts:[{text:'hello'}]}}});const eligible=rt.hub.eligibleAgents(task);assert.ok(eligible.some(a=>a.id==='jaco-seer'||a.id==='jaco-forge'));
  });

  console.log(`reflective-futures: PASS (${passed.length}/${passed.length})`);
} finally {
  for(const s of servers)await new Promise(r=>s.close(()=>r()));
  for(const r of roots)fs.rmSync(r,{recursive:true,force:true});
}
