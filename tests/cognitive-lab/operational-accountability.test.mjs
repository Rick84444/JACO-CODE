import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOperationalAccountability as assess} from '../../runtime/src/server/continuum/operationalAccountability.mjs';
const good={valid:true,count:0,headHash:'abcd'}, running={mode:'RUNNING',emergencyLatched:false};
const check=(o={})=>assess({events:[],integrity:good,operator:running,leases:[],...o});
const ev=(sequence,type,more={})=>({sequence,timestamp:'2026-10-29T00:00:00Z',hash:'hash'+sequence,type,stream:'runtime',...more});
test('a healthy Continuum is not independently READY',()=>{
 const x=check();assert.equal(x.ready,false);assert.equal(x.readiness,'NOT_VERIFIED');
});
test('recorded calculation and startup failures remain negative evidence',()=>{
 const x=check({events:[ev(1,'runtime.startup_invalid'),ev(2,'runtime.calculation_invalid')],integrity:{...good,count:2}});
 assert.equal(x.historicalPenaltyUnits,2);assert.equal(x.categories.startup,1);assert.equal(x.categories.calculation,1);
});
test('one operation cannot be double-penalized by bridge plus lease',()=>{
 const x=check({events:[ev(1,'lease.action_unknown',{entityId:'job',data:{operationId:'job'}}),ev(2,'cycle.bridge_unknown',{entityId:'job'})],integrity:{...good,count:2}});
 assert.equal(x.historicalPenaltyUnits,1);
});
test('unknown lease outcome blocks readiness, even while operator is running',()=>{
 const x=check({leases:[{id:'lease',operations:{a:{operationId:'a',status:'UNKNOWN_OUTCOME'}}}]});
 assert.equal(x.readiness,'BLOCKED');assert.equal(x.unresolvedCount,1);
});
test('pause and emergency stop block',()=>{
 assert.ok(check({operator:{mode:'PAUSED'}}).reasons.includes('OPERATOR_NOT_RUNNING'));
 assert.ok(check({operator:{mode:'STOPPED',emergencyLatched:true}}).reasons.includes('EMERGENCY_STOP_LATCHED'));
});
test('invalid event integrity blocks and suppresses lifetime penalty estimate',()=>{
 const x=check({integrity:{valid:false,count:2}});
 assert.equal(x.readiness,'BLOCKED');assert.equal(x.historicalPenaltyUnits,null);
});
test('simulated errors are not promoted to real incidents',()=>{
 const events=[ev(1,'cycle.bridge_unknown',{data:{simulation:'DETERMINISTIC'}}),ev(2,'runtime.integration_failed',{stream:'simulation'})];
 assert.equal(check({events,integrity:{...good,count:2}}).historicalPenaltyUnits,0);
});
test('incomplete historical coverage never claims a complete penalty count',()=>{
 const x=check({events:[ev(1,'runtime.startup_failed')],integrity:{...good,count:3}});
 assert.equal(x.coverage.complete,false);assert.equal(x.historicalPenaltyUnits,null);assert.equal(x.ready,false);
});
test('bad source arguments are rejected',()=>{
 assert.throws(()=>check({events:null}),/ACCOUNTABILITY_SOURCE_INVALID/);
 assert.throws(()=>check({leases:null}),/ACCOUNTABILITY_SOURCE_INVALID/);
});
