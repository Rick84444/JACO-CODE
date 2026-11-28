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
});import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {pinnedUpstreamChecker} from '../../scripts/verify-technical-debt.mjs';
const blob=data=>createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
function vendorTree(dirName='runtime/public/vendor/lib',content='export const a=1; \n// TODO upstream\n'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'debt-'));const dir=path.join(root,dirName);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'x.mjs'),content);
 fs.writeFileSync(path.join(dir,'UPSTREAM.md'),'# lib\n- modules/x.mjs: git blob '+blob(Buffer.from(content))+'\n');
 return {root,file:dirName+'/x.mjs'};
}
const diffFor=(file,lines)=>'diff --git a/'+file+' b/'+file+'\n+++ b/'+file+'\n'+lines.map(l=>'+'+l).join('\n')+'\n';
test('an exact-blob pinned vendored file keeps upstream formatting, but eval and debugger are still blocked',()=>{
 const {root,file}=vendorTree();const isPinnedUpstream=pinnedUpstreamChecker(root);
 assert.equal(isPinnedUpstream(file),true);
 assert.equal(auditDiff(diffFor(file,['export const a=1; ','// TODO upstream']),{isPinnedUpstream}).accepted,true);
 assert.deepEqual(auditDiff(diffFor(file,['eval(x);','debugger;']),{isPinnedUpstream}).findings.map(f=>f.code),['DYNAMIC_EVAL','DEBUGGER']);
});
test('a locally edited vendored file no longer matches its recorded blob and is audited in full',()=>{
 const {root,file}=vendorTree();fs.appendFileSync(path.join(root,file),'// edited \n');
 const isPinnedUpstream=pinnedUpstreamChecker(root);
 assert.equal(isPinnedUpstream(file),false);
 assert.deepEqual(auditDiff(diffFor(file,['export const a=1; ','// TODO upstream']),{isPinnedUpstream}).findings.map(f=>f.code),['TRAILING_WHITESPACE','UNRESOLVED_FIXME']);
});
test('an UPSTREAM.md outside a vendor directory exempts nothing, and the default is no exemption',()=>{
 const {root,file}=vendorTree('agents/lib/ownlib');
 assert.equal(pinnedUpstreamChecker(root)(file),false);
 assert.equal(auditDiff(diffFor(file,['export const a=1; '])).accepted,false);
});
