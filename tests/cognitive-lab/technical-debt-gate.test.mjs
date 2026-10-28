import test from 'node:test';import assert from 'node:assert/strict';
import {auditDiff} from '../../scripts/verify-technical-debt.mjs';
test('debt CI only inspects added executable source, not unchanged or deleted code',()=>{
 const d='diff --git a/agents/lib/a.mjs b/agents/lib/a.mjs\n+++ b/agents/lib/a.mjs\n- debugger;\n+export const sum=(a,b)=>a+b;\n';
 assert.deepEqual(auditDiff(d).findings,[]);assert.equal(auditDiff(d).addedLinesInspected,1);
});
test('debt CI blocks newly introduced TODO, debugger and dynamic eval',()=>{
 const d='diff --git a/agents/lib/a.mjs b/agents/lib/a.mjs\n+++ b/agents/lib/a.mjs\n+// TODO: clean later\n+debugger;\n+eval(untrusted);\n';
 assert.deepEqual(auditDiff(d).findings.map(x=>x.code),['UNRESOLVED_FIXME','DEBUGGER','DYNAMIC_EVAL']);
});
test('test fixtures are out of scope for production debt gate',()=>{
 const d='diff --git a/tests/example.test.mjs b/tests/example.test.mjs\n+++ b/tests/example.test.mjs\n+debugger;\n';
 assert.equal(auditDiff(d).accepted,true);
});