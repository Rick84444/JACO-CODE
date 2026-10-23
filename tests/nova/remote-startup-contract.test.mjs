import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test, { after } from 'node:test';
import { configuration,definitions,recoverableListener } from '../../agents/lib/local-stack.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-startup-contract-'));
fs.writeFileSync(path.join(root,'server.ts'),"app.get('/api/runtime/identity',()=>{});");fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'future-release'}));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('dependent recovery reuses only a verified owned listener, never a foreign port owner',()=>{
 assert.equal(recoverableListener(123,123),true);
 for(const pair of [[123,124],[null,123],[0,0],[-1,-1]])assert.equal(recoverableListener(...pair),false);
});
test('Remote Bridge required; Workplace is the sole SEER and Nova owner',()=>{
 const c=configuration(root,{}),services=definitions(c);
 assert.equal(services.find(s=>s.id==='remote').url,'http://127.0.0.1:2994/health');
 assert.deepEqual(services.find(s=>s.id==='seer').args,[]);
 assert.equal(services.some(s=>s.id==='nova'),false);
 assert.equal(c.env.JACO_WORKPLACE_SUPERVISE_NOVA,'1');
});
test('the agent connects its own browser by default; the ChatGPT gateway and tunnel stay opt-in',()=>{
 const c=configuration(root,{});assert.equal(c.cdp,true);assert.equal(c.gateway,false);assert.equal(c.tunnel,false);
 for(const id of ['novaBridge','cdp'])assert.ok(definitions(c).some(s=>s.id===id),id);
 assert.equal(definitions(c).some(s=>s.id==='gateway'),false);
 const off=configuration(root,{JACO_ENABLE_CDP:'0'});assert.equal(off.cdp,false);
 assert.equal(definitions(off).some(s=>['novaBridge','cdp','gateway'].includes(s.id)),false);
 const legacy=configuration(root,{JACO_ENABLE_CDP:'1',JACO_START_TUNNEL:'1'});
 assert.equal(legacy.tunnel,true);
 for(const id of ['novaBridge','cdp','gateway'])assert.ok(definitions(legacy).some(s=>s.id===id),id);
 assert.equal(configuration(root,{JACO_ENABLE_CHATGPT_GATEWAY:'1'}).gateway,true);
});
test('runtime must return the correct identity',()=>{
 const s=definitions(configuration(root,{})).find(s=>s.id==='runtime');
 assert.equal(s.accept({success:true,product:'JACO Autonomus IDE',version:'foreign'}),false);
 assert.equal(s.accept({success:true,product:'foreign',version:'future-release'}),false);
 assert.equal(s.accept({success:true,product:'JACO Autonomus IDE',version:'future-release'}),true);
});
