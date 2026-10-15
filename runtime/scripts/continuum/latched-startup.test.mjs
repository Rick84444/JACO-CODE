import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const { ContinuumRuntime } = await import('../../src/server/continuum/continuumRuntime.mjs');
class S{async list(){return []}}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'latch-'));
let rt=new ContinuumRuntime({workspaceRoot:root,browserSessions:new S()});rt.scheduler.start({actor:'t'});assert.equal(rt.scheduler.snapshot().enabled,true);
fs.writeFileSync(path.join(rt.root,'operator-control.json'),JSON.stringify({mode:'STOPPED',emergencyLatched:true,reason:'x',changedAt:new Date().toISOString(),changedBy:'test',generation:1}));
rt=new ContinuumRuntime({workspaceRoot:root,browserSessions:new S()});
assert.equal(rt.operator.snapshot().emergencyLatched,true);assert.equal(rt.scheduler.snapshot().timerActive,false);
rt.operator.resetEmergency('t');rt.operator.resume('t');rt.scheduler.start({actor:'t'});assert.equal(rt.scheduler.snapshot().timerActive,true);
console.log('LATCHED_STARTUP: PASS');process.exit(0);
