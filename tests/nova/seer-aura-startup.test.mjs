import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real SEER startup uses saved Aura choice, never local fallback or unauthorized cloud', async t => {
  const dir=mkdtempSync(join(tmpdir(),'seer-aura-startup-'));
  const choice=join(dir,'choice.json'), calls=[];
  let base;
  const fixture=createServer(async(req,res)=>{
    calls.push(req.url);
    res.setHeader('content-type','application/json');
    if(req.url==='/api/connected/nova/planner-providers') return res.end(JSON.stringify({providers:[
      {name:'fixture-local',url:base+'/v1/chat/completions',model:'fixture-model',local:true},
      {name:'fixture-cloud',url:'https://must-not-be-contacted.invalid/v1/chat/completions',model:'fixture-model',local:false},
    ]}));
    if(req.url==='/v1/chat/completions') {
      let body=''; for await(const c of req)body+=c;
      const payload=JSON.parse(body);
      assert.equal(payload.model,'fixture-model');
      assert.equal(payload.messages[0].content,'startup rules');
      assert.equal(payload.max_tokens,32);
      return res.end(JSON.stringify({choices:[{message:{content:'JACO_SEER_READY'}}]}));
    }
    res.statusCode=503;res.end('{"error":"unexpected_fixture_route"}');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${fixture.address().port}`;
  const save=provider=>writeFileSync(choice,JSON.stringify({provider,model:'fixture-model',by:'operator'}));
  save('fixture-local');
  const child=spawn(process.execPath,['gateway/src/seer-start.mjs'],{
    env:{PATH:process.env.PATH,SEER_PORT:'0',SEER_STATE_DIR:dir,JACO_RUNTIME_URL:base,
      JACO_GATEWAY_TOKEN:'fixture-startup-token-1234567890',JACO_PLANNER_CHOICE_FILE:choice,
      JACO_SEER_PROVIDER_PREFERENCE:'aura',JACO_ALLOW_PAID_MODELS:'0',
      JACO_LITERT_URL:base+'/v1',JACO_LLAMACPP_URL:base+'/v1',OLLAMA_BASE_URL:base,
      JACO_SEER_LOCAL_PROVIDER:'litert',JACO_SEER_LOCAL_MODEL:'stale-model',
      JACO_SEER_LOCAL_CHAT_URL:base+'/legacy',JACO_WORKPLACE_REQUIRED:'0',
      SEER_AUTONOMY_LOOP_MS:'0',SEER_GOVERNOR_INTERVAL_MS:'0'},
    stdio:['ignore','pipe','pipe'],
  });
  t.after(async()=>{
    child.kill('SIGTERM');
    if(child.exitCode===null && child.signalCode===null) await new Promise(r=>child.once('exit',r));
    await new Promise(r=>fixture.close(r));
    rmSync(dir,{recursive:true,force:true});
  });
  let output='';child.stderr.on('data',c=>output+=c);
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SEER_START_TIMEOUT '+output)),5000);
    child.once('exit',()=>{clearTimeout(timer);reject(Error('SEER_EXIT '+output));});
    child.stdout.on('data',c=>{output+=c;const m=output.match(/JACO_SEER_LISTENING port=(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
  });
  const ask=()=>fetch(`http://127.0.0.1:${port}/cortex/brain`,{
    method:'POST',headers:{Authorization:'Bearer fixture-startup-token-1234567890','content-type':'application/json'},
    body:JSON.stringify({system:'startup rules',user:'Return exactly: JACO_SEER_READY',max_tokens:32,temperature:0,startup_probe:true}),
  });
  let response=await ask();const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.provider,'fixture-local');
  assert.equal(result.text,'JACO_SEER_READY');
  save('fixture-cloud');
  response=await ask();assert.equal(response.status,503);
  assert.equal((await response.json()).error,'AURA_PROVIDER_INFERENCE_FAILED');
  rmSync(choice);
  response=await ask();assert.equal(response.status,503);
  assert.equal((await response.json()).error,'AURA_PROVIDER_CHOICE_REQUIRED');
  assert.deepEqual(calls,['/api/connected/nova/planner-providers','/v1/chat/completions']);
});
