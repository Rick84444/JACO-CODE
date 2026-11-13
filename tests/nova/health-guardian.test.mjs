import test from 'node:test';
import assert from 'node:assert/strict';
import { guardianTick, guardianBackoffMs, unhealthyServices } from '../../agents/lib/health-guardian.mjs';

test('health guardian never restarts ready services even if an old startup receipt said blocked', async () => {
  const state={};
  let restarts=0;
  const result=await guardianTick({},state,{
    inspect:async()=>({state:'DEGRADED',services:[{id:'runtime',state:'READY'},{id:'workplace',state:'READY'},{id:'nova-session',state:'READY'}]}),
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
  const state={unhealthySince:0,failures:2,nextAttemptAt:0};
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
  assert.deepEqual(unhealthyServices({services:[]}),['NO_CRITICAL_OBSERVATIONS']);
  assert.equal(guardianBackoffMs(1),30000);
  assert.equal(guardianBackoffMs(5),480000);
  assert.equal(guardianBackoffMs(100),600000);
});
