import test from 'node:test';
import assert from 'node:assert/strict';
import {plan} from './core.mjs';
test("parallel dependency schedule",()=>{assert.deepEqual(plan(...[[{"id":"a","deps":[],"minutes":5},{"id":"b","deps":[],"minutes":7},{"id":"c","deps":["a","b"],"minutes":3}]]),{"order":[{"id":"a","start":0,"end":5},{"id":"b","start":0,"end":7},{"id":"c","start":7,"end":10}],"ready":["a","b"],"totalMinutes":10});});
test("rejects missing dependency",()=>{assert.throws(()=>plan(...[[{"id":"a","deps":["b"],"minutes":1}]]),new RegExp("Missing dependency"));});
test("rejects cycle",()=>{assert.throws(()=>plan(...[[{"id":"a","deps":["b"],"minutes":1},{"id":"b","deps":["a"],"minutes":1}]]),new RegExp("Dependency cycle"));});
test("empty graph",()=>{assert.deepEqual(plan(...[[]]),{"order":[],"ready":[],"totalMinutes":0});});
