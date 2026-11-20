import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SecretStore } from '../../agents/lib/secret-store.mjs';
import { importVaultText } from '../../agents/lib/vault-bulk-import.mjs';
const makeStore=()=>{const data=new Map();return {data,has:n=>data.has(n),setIfAbsent:(n,v)=>{if(data.has(n))return false;data.set(n,v);return true;}};};
test('matches labelled services and unique prefixes without exposing credentials',()=>{
 const store=makeStore(); const secret='rnd_fixture123456';
 const r=importVaultText('render api '+secret+'\nopen ai fake-openai-value\nSTRIPE_SECRET_KEY=fake-stripe-value\n# comment',{store});
 assert.deepEqual(r.imported,['RENDER_API_KEY','OPENAI_API_KEY','STRIPE_SECRET_KEY']);
 assert.equal(store.data.get('RENDER_API_KEY'),secret);
 assert.ok(!JSON.stringify(r).includes(secret));
});
test('dry run, existing credentials, ambiguity and conflicts are safe',()=>{
 const store=makeStore();store.data.set('OPENAI_API_KEY','old-secret');
 const text='OPENAI_API_KEY=new-value\nsk-'+ 'a'.repeat(32)+'\nqwen first-secret\nqwen second-secret\nrender api candidate-value\nGATEWAY_TOKEN=never-import';
 const r=importVaultText(text,{store,dryRun:true});
 assert.deepEqual(r.kept,['OPENAI_API_KEY']);assert.deepEqual(r.ready,['RENDER_API_KEY']);
 assert.ok(r.pending.some(x=>x.reason==='AMBIGUOUS'));
 assert.ok(r.pending.some(x=>x.reason==='CONFLICTING_VALUES'));
 assert.ok(r.pending.some(x=>x.reason==='UNRECOGNIZED_NAME'));
 assert.equal(store.data.size,1);
});
test('opaque multi-value or unlabeled credentials are never guessed',()=>{
 const store=makeStore();
 const r=importVaultText('skyfire api fixture-one another-value\nskyfire 12345678\nunlabelled-uuid-value',{store});
 assert.equal(r.pending.length,3);assert.equal(store.data.size,0);
});
test('size bound and store failures are sanitized',()=>{
 const store={has:()=>false,setIfAbsent:()=>{throw Error('sensitive-value')}};
 assert.throws(()=>importVaultText('x'.repeat(129*1024),{store}),/TOO_LARGE/);
 const r=importVaultText('render api sensitive-value',{store});
 assert.equal(r.failed.length,1);assert.ok(!JSON.stringify(r).includes('sensitive-value'));
});

test('known credential prefix must agree with explicit service and generic Google needs a label',()=>{
 const store=makeStore();
 const r=importVaultText('openai rnd_fixture123456\nAIza_fixture_google_key\nQWEN_API_KEY=sk-'+ 'b'.repeat(32)+'\nrender api your_api_key',{store});
 assert.deepEqual(r.imported,['QWEN_API_KEY']);
 assert.equal(r.pending[0].reason,'LABEL_MISMATCH');
 assert.equal(r.pending[1].reason,'AMBIGUOUS');
 assert.equal(r.pending[2].reason,'MULTIPLE_OR_INVALID_VALUES');
});
test('Zapier URL is stored only for the real HTTPS MCP origin and exact path',()=>{
 const store=makeStore();
 const u='https://mcp.zapier.com/api/v1/connect?token=fixture-url-token';
 const r=importVaultText(u+'\nZAPIER_MCP_URL=https://mcp.zapier.com.evil.invalid/api/v1/connect?token=other\nopenai https://evil.invalid/key',{store});
 assert.deepEqual(r.imported,['ZAPIER_MCP_URL']);
 assert.equal(store.data.get('ZAPIER_MCP_URL'),u);
 assert.ok(!JSON.stringify(r).includes('fixture-url-token'));
 assert.deepEqual(r.pending.map(x=>x.reason),['INVALID_ENDPOINT','UNEXPECTED_URL']);
});

test('real vault encrypts values and atomic insert preserves an existing credential',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vault-bulk-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new SecretStore({dir,env:{}});
 const value='fixture-plaintext-must-not-persist';
 store.set('OPENAI_API_KEY',value);
 const r=importVaultText('OPENAI_API_KEY=fixture-other-value\nrender api fixture-render-value',{store});
 assert.deepEqual(r.kept,['OPENAI_API_KEY']);
 assert.deepEqual(r.imported,['RENDER_API_KEY']);
 assert.equal(store.get('OPENAI_API_KEY'),value);
 assert.equal(store.get('RENDER_API_KEY'),'fixture-render-value');
 assert.ok(!fs.readFileSync(path.join(dir,'secrets.json'),'utf8').includes(value));
});
test('concurrent processes preserve all independent credentials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vault-parallel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const uri=new URL('../../agents/lib/secret-store.mjs',import.meta.url).href;
 const code='import { SecretStore } from '+JSON.stringify(uri)+'; const store=new SecretStore({dir:process.argv[1],env:{}}); for(let i=0;i<12;i++) if(!store.setIfAbsent("FIXTURE_"+process.argv[2]+"_"+i,"fixture-value")) process.exit(3);';
 const run=n=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',code,dir,String(n)],{stdio:'ignore'});
   child.once('error',reject);child.once('exit',(status)=>status===0?resolve():reject(Error('child exit '+status)));
 });
 await Promise.all([0,1,2,3].map(run));
 assert.equal(new SecretStore({dir,env:{}}).list().length,48);
});
