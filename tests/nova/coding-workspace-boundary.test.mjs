import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCodingWorkspace} from '../../agents/lib/coding-workspace.mjs';
import {normalizeCodingContract} from '../../agents/lib/coding-contract.mjs';

function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-rw-boundary-'));
  const root=path.join(base,'repo'); fs.mkdirSync(root);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const contract=normalizeCodingContract({objective:'bounded edit',scope:{allowed:['src/**']},acceptance:['verified read/write']});
  fs.mkdirSync(path.join(root,'src'));
  const workspace=createCodingWorkspace({root});
  return {base,root,contract,workspace};
}

test('canonical workspace writes and reads allowed source with matching evidence',async t=>{
  const {root,contract,workspace}=fixture(t);
  const write=await workspace.execute({type:'repo-write',data:{path:'src/new/file.txt',content:'verified'}},contract);
  const read=await workspace.execute({type:'repo-read',data:{path:'src/new/file.txt'}},contract);
  assert.equal(read.content,'verified'); assert.equal(write.afterSha256,read.sha256);
  assert.deepEqual(fs.readdirSync(path.join(root,'src/new')),['file.txt']);
  await assert.rejects(workspace.execute({type:'repo-write',data:{path:'outside.txt',content:'no'}},contract),/SCOPE_DENIED/);
});

test('directory junction cannot redirect read or write outside the workspace',async t=>{
  const {base,root,contract,workspace}=fixture(t);
  const external=path.join(base,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'file.txt'),'unchanged');
  fs.symlinkSync(external,path.join(root,'src/link'),process.platform==='win32'?'junction':'dir');
  for(const type of ['repo-read','repo-write','repo-list']) await assert.rejects(workspace.execute({type,data:{path:type==='repo-list'?'src/link':'src/link/file.txt',content:'bad'}},contract),/LINK_DENIED/);
  assert.equal(fs.readFileSync(path.join(external,'file.txt'),'utf8'),'unchanged');
});

test('hardlinked source cannot reveal or replace another file',async t=>{
  const {base,root,contract,workspace}=fixture(t);
  const external=path.join(base,'private.txt');fs.writeFileSync(external,'private fixture');
  fs.linkSync(external,path.join(root,'src/alias.txt'));
  for(const type of ['repo-read','repo-write']) await assert.rejects(workspace.execute({type,data:{path:'src/alias.txt',content:'bad'}},contract),/HARDLINK_DENIED/);
  assert.equal(fs.readFileSync(external,'utf8'),'private fixture');
});

test('directory listing excludes forbidden entries and linked directories',async t=>{
  const {base,root,contract,workspace}=fixture(t);
  fs.writeFileSync(path.join(root,'src/.env'),'fixture only');fs.writeFileSync(path.join(root,'src/file.txt'),'ok');
  fs.symlinkSync(base,path.join(root,'src/link'),process.platform==='win32'?'junction':'dir');
  const listed=await workspace.execute({type:'repo-list',data:{path:'src'}},contract);
  assert.deepEqual(listed.entries.map(e=>e.name),['file.txt']);
});

// Operator 2026-10-03: exact text replacement, as Claude's Edit tool.
test('repo-edit replaces exactly the named text, keeps CRLF line endings, and refuses ambiguous or missing text',async t=>{
  const {root,contract,workspace}=fixture(t);
  const file=path.join(root,'src','a.js');
  fs.writeFileSync(file,'const a = 1;\r\nconst b = 2;\r\nconst b2 = 2;\r\n');
  const r=await workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'const a = 1;\nconst b = 2;',new:'const a = 10;\nconst b = 20;'}},contract);
  assert.equal(fs.readFileSync(file,'utf8'),'const a = 10;\r\nconst b = 20;\r\nconst b2 = 2;\r\n');
  assert.deepEqual([r.ok,r.verified,r.replacements],[true,true,1]);
  await assert.rejects(workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'zzz',new:'y'}},contract),/CODING_EDIT_OLD_NOT_FOUND/);
  await assert.rejects(workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'const',new:'let'}},contract),/CODING_EDIT_OLD_NOT_UNIQUE:3/);
  const all=await workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'const',new:'let',replaceAll:true}},contract);
  assert.equal(all.replacements,3);
  assert.equal(fs.readFileSync(file,'utf8'),'let a = 10;\r\nlet b = 20;\r\nlet b2 = 2;\r\n');
  await assert.rejects(workspace.execute({type:'repo-edit',data:{path:'outside.js',old:'x',new:'y'}},contract),/SCOPE_DENIED/);
  await assert.rejects(workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'let',new:'let'}},contract),/CODING_EDIT_NO_CHANGE/);
  await assert.rejects(workspace.execute({type:'repo-edit',data:{path:'src/a.js',old:'let'}},contract),/CODING_EDIT_NEW_INVALID/);
});
