import test from 'node:test';
import assert from 'node:assert/strict';
import {logs} from './core.mjs';
test("classifies levels",()=>{assert.deepEqual(logs(...["[INFO] Started\n[ERROR] Failure\nWARN: slow\nanything"]),{"counts":{"ERROR":1,"WARN":1,"INFO":1,"DEBUG":0,"OTHER":1},"rows":[{"line":1,"level":"INFO","message":"[INFO] Started"},{"line":2,"level":"ERROR","message":"[ERROR] Failure"},{"line":3,"level":"WARN","message":"WARN: slow"},{"line":4,"level":"OTHER","message":"anything"}]});});
test("normalizes warning",()=>{assert.deepEqual(logs(...["[WARNING] slow"]),{"counts":{"ERROR":0,"WARN":1,"INFO":0,"DEBUG":0,"OTHER":0},"rows":[{"line":1,"level":"WARN","message":"[WARNING] slow"}]});});
test("empty input",()=>{assert.deepEqual(logs(...[""]),{"counts":{"ERROR":0,"WARN":0,"INFO":0,"DEBUG":0,"OTHER":0},"rows":[]});});
