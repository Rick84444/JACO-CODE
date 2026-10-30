import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemControl } from '../src/system-control.mjs';

function fixture(jacoctl) {
  const calls=[];
  const execFileImpl=async(file,args)=>{
    calls.push([file,...args]);
    return {stdout:JSON.stringify({ok:true}),stderr:''};
  };
  const system=new SystemControl({ jacoctl, core:{identity:async()=>({})}, runtimeRoot:'/runtime', repoRoot:'/repo', execFileImpl });
  return {system,calls};
}

test('a Node jacoctl entry point runs under the current Node executable', async()=>{
  const {system,calls}=fixture('/repo/agents/jaco-cli.mjs');
  assert.deepEqual(await system.status(),{ok:true});
  assert.deepEqual(calls,[[process.execPath,'/repo/agents/jaco-cli.mjs','status','--json']]);
});

test('an executable jacoctl wrapper is still run directly', async()=>{
  const {system,calls}=fixture('/runtime/bin/jacoctl');
  await system.activate('full',{fromMcp:false});
  assert.deepEqual(calls,[['/runtime/bin/jacoctl','activate','--profile','full','--json']]);
});
