import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceDrafts, writeWorkspaceDrafts, timestampChatMessages } from '../../runtime/src/lib/auraRecovery.mjs';
import { canSwitchProject } from '../../runtime/src/lib/auraProject.mjs';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const file = { path:'example.ts', content:'original', hash:'original-hash', language:'typescript', size:8 };
test('reload restores chat and code drafts with original conflict hash, scoped by project', () => {
  const disk=storage();
  writeWorkspaceDrafts(disk,'/one','unfinished question',{'example.ts':'new code'},{'example.ts':file});
  const restored=readWorkspaceDrafts(disk,'/one');
  assert.equal(restored.input,'unfinished question');
  assert.equal(restored.drafts['example.ts'],'new code');
  assert.equal(restored.documents['example.ts'].hash,'original-hash');
  assert.deepEqual(readWorkspaceDrafts(disk,'/two'),{input:'',documents:{},drafts:{}});
});
test('saved or reverted files leave neither a project lock nor an obsolete recovery draft', () => {
  const disk=storage(), documents={'example.ts':file};
  writeWorkspaceDrafts(disk,'/one','',{'example.ts':'edited'},documents);
  assert.equal(canSwitchProject({'example.ts':'edited'},documents),false);
  assert.equal(canSwitchProject({'example.ts':'original'},documents),true);
  writeWorkspaceDrafts(disk,'/one','',{'example.ts':'original'},documents);
  assert.deepEqual(readWorkspaceDrafts(disk,'/one').drafts,{});
  assert.equal(canSwitchProject({'unknown.ts':'unsaved'},documents),false);
});
test('corrupt recovery and blocked storage are surfaced instead of silently treated as saved', () => {
  assert.throws(()=>readWorkspaceDrafts({getItem:()=>'{broken'},'/one'));
  assert.throws(()=>readWorkspaceDrafts({getItem:()=>JSON.stringify({version:1,root:'/other',input:'',files:[]})},'/one'),/DRAFT_FORMAT_INVALID/);
  assert.throws(()=>writeWorkspaceDrafts({setItem(){throw Error('QUOTA');}},'/one','keep this',{},{}),/QUOTA/);
});
test('new local errors receive a time after historic messages without rewriting observed timestamps', () => {
  const old={id:'old',at:'2026-01-01T00:00:00.000Z',content:'historic'};
  const result=timestampChatMessages([old,{id:'error',content:'failed'}],'2026-10-16T16:00:00.000Z');
  assert.equal(result[0],old);
  assert.equal(result[1].at,'2026-10-16T16:00:00.000Z');
  assert.deepEqual([...result].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(x=>x.id),['old','error']);
});


test('persistent recovery rejects traversal and control characters in stored paths', () => {
  const disk=storage();
  const unsafe = ['/etc/secrets.html','../secrets.html','site/../secrets.html','C:/secrets.html','site/hi\\u0001.html'];
  for(const path of unsafe) {
    const altered={...file,path};
    assert.throws(()=>writeWorkspaceDrafts(disk,'/one','',{[path]:'modified'},{[path]:altered}),/DRAFT_BASE_MISSING/);
  }
  assert.throws(()=>readWorkspaceDrafts({ getItem:()=>JSON.stringify({
    version:1,root:'/one',input:'',files:[{file:{...file,path:'../outside.html'},draft:'modified'}]
  })},'/one'),/DRAFT_FORMAT_INVALID/);
});

test('persistent recovery fails closed on oversized or corrupted archives', () => {
  const disk=storage();
  assert.throws(()=>writeWorkspaceDrafts(disk,'/one','',{'example.ts':'x'.repeat(3_000_001)},{'example.ts':file}),/DRAFT_ARCHIVE_TOO_LARGE/);
  assert.throws(()=>writeWorkspaceDrafts(disk,'/one','',Object.fromEntries(Array.from({length:25},(_,i)=>['file'+i+'.ts','x'])),{}),/DRAFT_FILES_LIMIT/);
  assert.throws(()=>readWorkspaceDrafts({getItem:()=>JSON.stringify({
    version:1,root:'/one',input:'',files:Array.from({length:25},()=>({file,draft:'x'}))
  })},'/one'),/DRAFT_FORMAT_INVALID/);
});
