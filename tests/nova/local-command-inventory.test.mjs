import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {discoverLocalCommands,localCommandHint} from '../../agents/lib/local-command-inventory.mjs';
import {SafeShell,classify} from '../../agents/lib/safe-shell.mjs';

test('actual local inventory discovers executable fixtures, not files without execute permission or relative PATH', {skip:process.platform==='win32'},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aura-path-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const name of ['python3','pwsh','custom-tool','node']){fs.writeFileSync(path.join(dir,name),'#!/bin/sh\nexit 0\n',{mode:0o700});}
  fs.writeFileSync(path.join(dir,'not-executable'),'private data',{mode:0o600});
  const env={PATH:dir+':relative',SECRET_TOKEN:'never-return-this'};
  const result=discoverLocalCommands({env,execPath:path.join(dir,'node')});
  assert.deepEqual(result.programs,['pwsh','python3','node','custom-tool']);
  assert.equal(result.totalDiscovered,4);
  assert.deepEqual(discoverLocalCommands({env,query:'data processing'}).programs,['python3']);
  const python=result.capabilities.find(x=>x.name==='python3');
  assert.equal(python.knowledge,'curated');assert.equal(python.execution,'unverified');assert.deepEqual(python.exampleArgs,['--version']);
  assert.equal(result.capabilities.find(x=>x.name==='custom-tool').knowledge,'unknown');
  assert.deepEqual(discoverLocalCommands({env,query:'custom'}).programs,['custom-tool']);
  assert.equal(discoverLocalCommands({env,limit:1}).omitted,3);
  assert.ok(!JSON.stringify(result).includes(dir)&&!JSON.stringify(result).includes(env.SECRET_TOKEN));
  assert.ok(localCommandHint({env}).available.includes('python3'));
  const info=new SafeShell({workspace:dir,env,auditFile:false}).info({query:'custom'});
  assert.deepEqual(info.local.programs,['custom-tool']);
  assert.equal(classify('custom-tool',[],{workspace:dir,env}).ok,false,'discovery does not expand the execution allowlist');
});
test('Windows Path casing, executable extensions and duplicate names are handled',()=>{
  const rows=['PowerShell.EXE','pwsh.exe','python.exe','py.exe','npm.cmd','npm.exe','readme.txt','git.exe'];
  const api={opendirSync:()=>{let i=0;return {readSync:()=>i<rows.length?{name:rows[i++]}:null,closeSync(){}}},statSync:()=>({isFile:()=>true})};
  const result=discoverLocalCommands({env:{Path:'C:\\Tools;relative'},platform:'win32',execPath:'C:\\Node\\node.exe',api});
  assert.deepEqual(result.priority,['powershell','pwsh','python','py','node','npm','git']);
  assert.equal(result.totalDiscovered,7);
  assert.ok(!JSON.stringify(result).includes('C:\\\\Tools'));
});
