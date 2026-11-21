import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SystemControl } from '../src/system-control.mjs';

function fixture(execFileImpl,repoRoot='/tmp/jaco-fake') {
  return new SystemControl({
    jacoctl:path.join(repoRoot,'agents','jaco-cli.mjs'),
    repoRoot,
    runtimeRoot:path.join(repoRoot,'runtime'),
    core:{ identity:async()=>({success:true}) },
    execFileImpl,
  });
}

test('Windows Node CLI is launched under current Node without bash wrapper',async()=>{
  const seen=[];
  const system=fixture(async(file,args)=>{
    seen.push([file,...args]);
    return {stdout:JSON.stringify({schema:'jaco.activation/v2',ok:true,problems:[]}),stderr:''};
  });
  const r=await system.runCtl(['activate','--profile','full','--json']);
  assert.equal(r.ok,true);
  assert.equal(seen[0][0],process.execPath);
  assert.match(seen[0][1],/jaco-cli.mjs$/);
  assert.deepEqual(seen[0].slice(2),['activate','--profile','full','--json']);
});

test('Windows exit code 1 still returns structured jaco.activation/v2 JSON',async()=>{
  const output={schema:'jaco.activation/v2',ok:false,problems:['BROWSER_ATTACHMENT_FAILED'],startup:{
    state:'DEGRADED',phase:'browser-attachment',browserAttachment:'FAILED',ok:false}};
  const system=fixture(async()=>{const err=new Error('process exit 1: PRIVATE_PATH');err.code=1;err.stdout=JSON.stringify(output);err.stderr='PRIVATE_SECRET';throw err});
  const result=await system.runCtl(['activate','--profile','full','--json']);
  assert.deepEqual(result,output);
});

test('Malformed JSON or non-CLI process failures still fail closed',async()=>{
  const system=fixture(async()=>{const err=new Error('process exit 1');err.code=1;err.stdout='not JSON';throw err});
  await assert.rejects(system.runCtl(['activate','--json']),/process exit 1/);
});

test('Windows status is DEGRADED when Core is running but starter was blocked',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-windows-status-'));
  try {
    fs.mkdirSync(path.join(root,'logs','startup'),{recursive:true});
    fs.writeFileSync(path.join(root,'logs','startup','status.json'),JSON.stringify({
      schema:'jaco.local-startup/v1',state:'BLOCKED',phase:'browser-attachment',
      browserAttachment:'FAILED',expected:{browserAttachment:true}
    }));
    const system=fixture(async()=>({stdout:JSON.stringify({schema:'jaco.activation/v2',ok:true,problems:[]}),stderr:''}),root);
    const result=await system.status();
    assert.equal(result.ok,false);
    assert.equal(result.startup.state,'BLOCKED');
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('independent Windows service health is DEGRADED while browser attachment is blocked',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-windows-health-'));
  try {
    fs.mkdirSync(path.join(root,'logs','startup'),{recursive:true});
    fs.writeFileSync(path.join(root,'logs','startup','status.json'),JSON.stringify({
      schema:'jaco.local-startup/v1',state:'BLOCKED',phase:'browser-attachment',
      browserAttachment:'FAILED',expected:{browserAttachment:true}
    }));
    const system=new SystemControl({
      jacoctl:path.join(root,'agents','jaco-cli.mjs'),repoRoot:root,runtimeRoot:path.join(root,'runtime'),
      core:{request:async()=>({success:true})},
      fetchImpl:async()=>({ok:true,json:async()=>({product:'JACO Workplace',supervisedAgents:{
        state:'RUNNING',nova:{state:'RUNNING'}}})}),
    });
    const result=await system.health();
    assert.equal(result.core.up,true);
    assert.equal(result.workplace.state,'RUNNING');
    assert.equal(result.status,'DEGRADED');
    assert.equal(result.startup.browserAttachment,'FAILED');
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});


test('Windows MCP health and status read the checkout receipt, not a stale repoRoot', async t => {
  const checkout=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-checkout-'));
  const staleRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-stale-root-'));
  t.after(()=>{fs.rmSync(checkout,{recursive:true,force:true});fs.rmSync(staleRoot,{recursive:true,force:true})});
  const file=root=>path.join(root,'logs','startup','status.json');
  for (const root of [checkout,staleRoot]) fs.mkdirSync(path.dirname(file(root)),{recursive:true});
  fs.writeFileSync(file(checkout),JSON.stringify({
    schema:'jaco.local-startup/v1',state:'READY',phase:'complete',
    browserAttachment:'ATTACHED',expected:{browserAttachment:true}
  }));
  fs.writeFileSync(file(staleRoot),JSON.stringify({
    schema:'jaco.local-startup/v1',state:'BLOCKED',phase:'browser-attachment',
    browserAttachment:'FAILED',expected:{browserAttachment:true}
  }));
  const saved=process.env.JACO_DATA_DIR;
  delete process.env.JACO_DATA_DIR;
  try {
    const system=new SystemControl({
      jacoctl:path.join(checkout,'agents','jaco-cli.mjs'),
      repoRoot:staleRoot,runtimeRoot:path.join(checkout,'runtime'),
      core:{request:async()=>({success:true})},
      fetchImpl:async()=>({ok:true,json:async()=>({
        product:'JACO Workplace',supervisedAgents:{state:'RUNNING',nova:{state:'RUNNING'}}
      })}),
      execFileImpl:async()=>({stdout:JSON.stringify({
        schema:'jaco.activation/v2',ok:true,problems:[]}),stderr:''}),
    });
    assert.equal(system.startupDataRoot,checkout);
    const health=await system.health();
    assert.equal(health.status,'READY');
    assert.equal(health.startup.browserAttachment,'ATTACHED');
    assert.equal(health.startup.ok,true);
    const status=await system.status();
    assert.equal(status.ok,true);
    assert.equal(status.startup.state,'READY');
  } finally {
    if (saved === undefined) delete process.env.JACO_DATA_DIR;
    else process.env.JACO_DATA_DIR=saved;
  }
});

test('explicit startup data root overrides checkout, and missing evidence fails closed', async t => {
  const checkout=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-checkout-'));
  const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-data-root-'));
  t.after(()=>{fs.rmSync(checkout,{recursive:true,force:true});fs.rmSync(dataRoot,{recursive:true,force:true})});
  const system=new SystemControl({
    jacoctl:path.join(checkout,'agents','jaco-cli.mjs'),
    repoRoot:checkout,startupDataRoot:dataRoot,
    core:{request:async()=>({success:true})},
    fetchImpl:async()=>({ok:true,json:async()=>({
      product:'JACO Workplace',supervisedAgents:{state:'RUNNING',nova:{state:'RUNNING'}}
    })}),
    execFileImpl:async()=>({stdout:JSON.stringify({
      schema:'jaco.activation/v2',ok:true,problems:[]}),stderr:''}),
  });
  assert.equal((await system.health()).status,'DEGRADED');
  assert.equal((await system.status()).startup.state,'UNVERIFIED');
  const receipt=path.join(dataRoot,'logs','startup','status.json');
  fs.mkdirSync(path.dirname(receipt),{recursive:true});
  fs.writeFileSync(receipt,JSON.stringify({
    schema:'jaco.local-startup/v1',state:'READY',phase:'complete',
    browserAttachment:'ATTACHED',expected:{browserAttachment:true}
  }));
  assert.equal((await system.health()).status,'READY');
  assert.equal((await system.status()).startup.ok,true);
});
