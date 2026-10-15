import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('real SEER forwards Nova context, routes local inference and disables paid fallback',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'seer-nova-'));
  let failModel=false,seen;
  const upstream=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/connected/nova/current') return res.end(JSON.stringify({success:true,mission:{id:'m1',goal:'local fixture',receipts:[{verified:true}]}}));
    // Failed-model rediscovery must stay inside this test, never contact the
    // operator's real Ollama/LiteRT processes on default ports.
    if(req.method==='GET') { res.statusCode=503; return res.end(JSON.stringify({error:'fixture_provider_unavailable'})); }
    let b='';for await(const c of req)b+=c;seen=JSON.parse(b);
    res.statusCode=failModel?503:200;
    res.end(JSON.stringify(failModel?{error:'offline'}:{choices:[{message:{content:'{"complete":true}'}}]}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${upstream.address().port}`;
  const child=spawn(process.execPath,['gateway/src/seer.mjs'],{env:{PATH:process.env.PATH,SEER_PORT:'0',SEER_STATE_DIR:dir,JACO_GATEWAY_TOKEN:'test-token-12345678901234567890',JACO_RUNTIME_URL:url,JACO_LITERT_URL:url+'/v1',OLLAMA_BASE_URL:url,JACO_WORKPLACE_REQUIRED:'0',SEER_AUTONOMY_LOOP_MS:'0',SEER_GOVERNOR_INTERVAL_MS:'0',JACO_SEER_LOCAL_PROVIDER:'litert',JACO_SEER_LOCAL_CHAT_URL:url+'/v1/chat/completions',JACO_SEER_LOCAL_MODEL:'test-gemma',JACO_SEER_LOCAL_SOURCE:'test-fixture',DEEPSEEK_API_KEY:'unused-fixture-key'},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',c=>output+=c);
  try{
    const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SEER_START_TIMEOUT '+output)),5000);child.once('exit',()=>{clearTimeout(timer);reject(Error('SEER_EXIT '+output));});child.stdout.on('data',c=>{output+=c;const m=output.match(/JACO_SEER_LISTENING port=(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
    const base=`http://127.0.0.1:${port}`,headers={Authorization:'Bearer test-token-12345678901234567890','content-type':'application/json'};
    assert.equal((await fetch(base+'/cortex/context/claude')).status,401);
    const context=await (await fetch(base+'/cortex/context/claude',{headers})).json();assert.equal(context.nova.mission.id,'m1');
    const proxy=await (await fetch(base+'/cortex/nova/current',{headers})).json();assert.equal(proxy.mission.goal,'local fixture');
    const ask=()=>fetch(base+'/cortex/brain',{method:'POST',headers,body:JSON.stringify({system:'rules',user:'mission receipt',max_tokens:999999})});
    const brain=await (await ask()).json();assert.equal(brain.ok,true);assert.equal(brain.provider,'litert');assert.equal(brain.model,'test-gemma');assert.equal(brain.local,true);assert.equal(seen.max_tokens,2048);assert.equal(seen.model,'test-gemma');
    assert.match(seen.messages[0].content,/\[JACO ACTIVE MEMORY\]/);

    const ready=await (await fetch(base+'/cortex/brain',{
      method:'POST',headers,
      body:JSON.stringify({system:'startup rules',user:'Return exactly: JACO_SEER_READY',max_tokens:32,temperature:0,startup_probe:true})
    })).json();
    assert.equal(ready.ok,true);
    assert.equal(seen.messages[0].content,'startup rules');
    assert.doesNotMatch(seen.messages[0].content,/\[JACO ACTIVE MEMORY\]/);
    assert.equal(seen.max_tokens,32);

    const started=await (await fetch(base+'/cortex/strategy/start',{
      method:'POST',headers,
      body:JSON.stringify({
        goal:'Use Desktop AgentOS to inspect the active application',
        tool_hint:{kind:'agent',agentId:'agent:desktop',agentName:'Desktop AgentOS',toolName:'desktop-observe'}
      })
    })).json();
    assert.equal(started.schema,'jaco.operator-goal/v1');
    const primary=await (await fetch(base+'/cortex/memory/seer.operator_primary_goal',{headers})).json();
    assert.equal(primary.value.tool_hint.toolName,'desktop-observe');
    assert.equal(primary.value.tool_hint.agentName,'Desktop AgentOS');

    failModel=true;assert.equal((await ask()).status,503);
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});}
});


test('SEER rediscovery recovers when a local provider appears after bootstrap',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'seer-late-provider-'));
  const token='test-token-12345678901234567890';

  const runtime=createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/connected/nova/current') return res.end(JSON.stringify({success:true,mission:null}));
    res.statusCode=404;res.end(JSON.stringify({error:'not_found'}));
  });
  await new Promise(r=>runtime.listen(0,'127.0.0.1',r));
  const runtimeUrl=`http://127.0.0.1:${runtime.address().port}`;

  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.method==='GET'&&req.url==='/v1/models'){
      return res.end(JSON.stringify({data:[{id:'late-gemma'}]}));
    }
    if(req.method==='POST'&&req.url==='/v1/chat/completions'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw||'{}');
      assert.equal(body.model,'late-gemma');
      return res.end(JSON.stringify({choices:[{message:{content:'LATE_PROVIDER_OK'}}]}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:'not_found'}));
  });

  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const providerPort=provider.address().port;
  await new Promise(r=>provider.close(r));

  const child=spawn(process.execPath,[fileURLToPath(new URL('../../gateway/src/seer-start.mjs',import.meta.url))],{
    cwd:dir, // dotenv must not read the operator checkout's credentials/config.
    env:{
      PATH:process.env.PATH,
      SEER_PORT:'0',
      SEER_STATE_DIR:dir,
      JACO_GATEWAY_TOKEN:token,
      JACO_RUNTIME_URL:runtimeUrl,
      JACO_WORKPLACE_REQUIRED:'0',
      JACO_LITERT_URL:`http://127.0.0.1:${providerPort}/v1`,
      JACO_LITERT_MODEL:'late-gemma',
      JACO_SEER_PROVIDER_PREFERENCE:'litert',
      OLLAMA_BASE_URL:'http://127.0.0.1:9',
      JACO_SEER_MODEL_DISCOVERY_TIMEOUT_MS:'100',
      JACO_ALLOW_PAID_MODELS:'0',
      DEEPSEEK_API_KEY:'unused',
      GEMINI_API_KEY:'unused',
      QWEN_API_KEY:'unused'
    },
    stdio:['ignore','pipe','pipe']
  });

  let output='';
  child.stderr.on('data',chunk=>output+=chunk);

  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('SEER_START_TIMEOUT '+output)),5000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('SEER_EXIT '+output));});
      child.stdout.on('data',chunk=>{
        output+=chunk;
        const match=output.match(/JACO_SEER_LISTENING port=(\d+)/);
        if(match){clearTimeout(timer);resolve(match[1]);}
      });
    });

    const base=`http://127.0.0.1:${port}`;
    const headers={Authorization:`Bearer ${token}`,'content-type':'application/json'};
    const ask=()=>fetch(base+'/cortex/brain',{
      method:'POST',
      headers,
      body:JSON.stringify({system:'rules',user:'reply',max_tokens:32,temperature:0})
    });

    const beforeHealth=await (await fetch(base+'/health')).json();
    assert.equal(beforeHealth.local_model,null);

    const before=await ask();
    assert.equal(before.status,503);
    assert.equal((await before.json()).error,'all_providers_failed');

    await new Promise((resolve,reject)=>{
      provider.once('error',reject);
      provider.listen(providerPort,'127.0.0.1',resolve);
    });

    const after=await (await ask()).json();
    assert.equal(after.ok,true);
    assert.equal(after.text,'LATE_PROVIDER_OK');
    assert.equal(after.provider,'litert');
    assert.equal(after.model,'late-gemma');
    assert.equal(after.local,true);

    const afterHealth=await (await fetch(base+'/health')).json();
    assert.equal(afterHealth.local_model.provider,'litert');
    assert.equal(afterHealth.local_model.model,'late-gemma');
    assert.equal(afterHealth.local_model.hosting,'on-device');
    assert.ok(afterHealth.local_model_discovery.lastSuccessAt);
  }finally{
    child.kill();
    await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
    provider.closeAllConnections();
    if(provider.listening) await new Promise(r=>provider.close(r));
    runtime.closeAllConnections();
    await new Promise(r=>runtime.close(r));
    rmSync(dir,{recursive:true,force:true});
  }
});
