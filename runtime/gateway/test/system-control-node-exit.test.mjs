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
