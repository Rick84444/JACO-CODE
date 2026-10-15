// An inbound A2A task handled by a model must carry the model's answer back to the
// requesting peer, not only an evidence receipt. Other task kinds keep hub state lean.
import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
const { ContinuumRuntime } = await import('../../src/server/continuum/continuumRuntime.mjs');
const { resultArtifact, receiptArtifact } = await import('../../gateway/src/a2a-continuum-state.mjs');
class S{async list(){return []}}

// Local OpenAI-compatible stand-in for llama-server.
const stub=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c).on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'stub',model:'stub-model',choices:[{message:{role:'assistant',content:'ANSWER: 4'}}]}));});});
await new Promise(r=>stub.listen(0,'127.0.0.1',r));
process.env.JACO_OLLAMA_URL='http://127.0.0.1:1';
process.env.JACO_LLAMACPP_URL=`http://127.0.0.1:${stub.address().port}`;
process.env.JACO_LLAMACPP_MODEL='stub-model.gguf';
try{
  const rt=new ContinuumRuntime({workspaceRoot:fs.mkdtempSync(path.join(os.tmpdir(),'a2a-result-')),browserSessions:new S()});
  rt.scheduler.state.enabled=true;
  const task=rt.hub.createTask({title:'A2A inbound',kind:'A2A_INBOUND',requirements:['A2A_INBOUND'],payload:{message:{parts:[{text:'2+2?'}]},external:true}});
  for(let i=0;i<5&&rt.hub.listTasks().find(t=>t.id===task.id).status!=='COMPLETED';i++)await rt.scheduler.tick();
  const done=rt.hub.listTasks().find(t=>t.id===task.id);
  assert.equal(done.status,'COMPLETED',JSON.stringify(done.lastError||done.status));
  assert.equal(done.result.text,'ANSWER: 4');
  assert.equal(done.result.providerId,'llamacpp-env');

  const answer=resultArtifact(done);
  assert.equal(answer.artifactId,`continuum-result-${done.id}`);
  assert.equal(answer.parts[0].content.$case,'text');assert.equal(answer.parts[0].content.value,'ANSWER: 4');
  assert.deepEqual(answer.metadata.evidenceRefs,done.evidenceRefs.map(String));
  assert.ok(receiptArtifact(done).parts[0].content.value.evidenceRefs.length>0,'receipt still references evidence');

  // Completion without a result (external executor, or non-A2A work) yields no answer artifact.
  assert.equal(resultArtifact({id:'x',status:'COMPLETED',evidenceRefs:['e']}),null);
  const long='y'.repeat(40000);
  const other=rt.hub.createTask({title:'other',kind:'GENERIC',requirements:[],payload:{}});
  rt.hub.claimTask(other.id,'jaco-seer','');
  const bounded=rt.hub.completeTask(other.id,{agentId:'jaco-seer',status:'COMPLETED',evidenceRefs:done.evidenceRefs,result:{text:long}});
  assert.equal(bounded.result.text.length,32000);assert.equal(bounded.result.truncated,true);
  console.log('A2A_RESULT_DELIVERY: PASS');
}finally{stub.close();}
process.exit(0);
