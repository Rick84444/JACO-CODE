import test from 'node:test';
import assert from 'node:assert/strict';
import { guardianTick, guardianBackoffMs, unhealthyServices } from '../../agents/lib/health-guardian.mjs';

test('health guardian never restarts ready services even if an old startup receipt said blocked', async () => {
  const state={};
  let restarts=0;
  const result=await guardianTick({},state,{
    inspect:async()=>({state:'DEGRADED',services:[{id:'runtime',state:'READY'},{id:'workplace',state:'READY'},{id:'nova-supervisor',state:'READY'},{id:'nova-session',state:'READY'}]}),
    activateStack:async()=>{restarts++;},
    now:1000,
  });
  assert.equal(result.kind,'HEALTHY');
  assert.equal(restarts,0);
});

test('dead critical service triggers canonical activation without opening a GUI', async () => {
  const state={};
  const calls=[];
  const deps={
    inspect:async()=>({services:[{id:'runtime',state:'DOWN'},{id:'workplace',state:'READY'}]}),
    activateStack:async (_c,args)=>{calls.push(args);return {state:'READY'};},
    restartCore:async()=>assert.fail('no forced termination before sustained outage'),
  };
  const result=await guardianTick({},state,{...deps,now:1000});
  assert.equal(result.kind,'STARTED');
  assert.deepEqual(calls,[{open:false}]);
  assert.equal((await guardianTick({},state,{...deps,now:1100})).kind,'COOLDOWN');
});

test('sustained core outage requests ownership-verified recycling, never workplace termination', async () => {
  const state={unhealthySinceByService:{runtime:0},failures:2,nextAttemptAt:0};
  const recycling=[];
  const result=await guardianTick({},state,{
    inspect:async()=>({services:[{id:'runtime',state:'UNHEALTHY'},{id:'nova-session',state:'DOWN'}]}),
    restartCore:async(_c,opts)=>{recycling.push(opts);return {restarted:false,reason:'FOREIGN_LISTENER'};},
    activateStack:async()=>{throw Error('PORT_CONFLICT_OR_UNHEALTHY');},
    now:301000,
  });
  assert.equal(result.kind,'RETRY_SCHEDULED');
  assert.equal(result.recycling.reason,'FOREIGN_LISTENER');
  assert.deepEqual(recycling,[{unhealthyForMs:301000}]);
  assert.ok(state.nextAttemptAt>301000);
});

test('no-critical-observations is unhealthy and exponential retry is bounded', () => {
  assert.deepEqual(unhealthyServices({services:[]}),['runtime','workplace','nova-supervisor','nova-session']);
  assert.equal(guardianBackoffMs(1),30000);
  assert.equal(guardianBackoffMs(5),480000);
  assert.equal(guardianBackoffMs(100),600000);
});

test('a missing critical probe is not mistaken for a healthy installed stack', async () => {
  const state={};
  const expected=[{id:'runtime',state:'READY'},{id:'workplace',state:'READY'}];
  const pending=unhealthyServices({services:expected});
  assert.deepEqual(pending,['nova-supervisor','nova-session']);
  const result=await guardianTick({},state,{
    inspect:async()=>({services:expected}),
    activateStack:async()=>({state:'BLOCKED'}),
    now:1000,
  });
  assert.equal(result.kind,'DEGRADED');
  assert.equal(state.unhealthySinceByService.runtime,undefined);
  assert.equal(state.unhealthySinceByService['nova-supervisor'],1000);
});

test('worker outage does not carry over its old failure clock to a new Core failure', async () => {
  const state={unhealthySinceByService:{'nova-session':0},failures:0,nextAttemptAt:0};
  let forced=0;
  const result=await guardianTick({},state,{
    inspect:async()=>({services:[{id:'runtime',state:'UNHEALTHY'},{id:'workplace',state:'READY'},{id:'nova-supervisor',state:'READY'},{id:'nova-session',state:'UNHEALTHY'}]}),
    restartCore:async()=>{forced++;return{restarted:true};},
    activateStack:async()=>({state:'BLOCKED'}),
    now:300100,
  });
  assert.equal(result.kind,'DEGRADED');
  assert.equal(forced,0,'only the Core own sustained outage can authorize recycling');
  assert.equal(state.unhealthySinceByService.runtime,300100);
  assert.equal(state.unhealthySinceByService['nova-session'],0);
});

test('guardian still tries canonical activation if Core recycle diagnosis fails', async () => {
  const state={unhealthySinceByService:{runtime:0},failures:0,nextAttemptAt:0};
  let activated=0;
  const result=await guardianTick({},state,{
    inspect:async()=>({services:[{id:'runtime',state:'UNHEALTHY'},{id:'workplace',state:'READY'},{id:'nova-supervisor',state:'READY'},{id:'nova-session',state:'READY'}]}),
    restartCore:async()=>{throw Error('WMI_TEMPORARILY_UNAVAILABLE');},
    activateStack:async()=>{activated++;return{state:'BLOCKED'};},
    now:300100,
  });
  assert.equal(activated,1);
  assert.equal(result.recycling.reason,'CORE_RECYCLE_DIAGNOSTIC_FAILED');
});
