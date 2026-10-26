import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { createAuraChatSession, operatorMemoryContext } from '../../runtime/src/server/connected/auraChatSession.mjs';

test('private conversation survives database reopen, uses encrypted content and idempotent append', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aura-private-chat-'));
  let bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  let chat=createAuraChatSession(bus);
  const input={id:'operator-message',role:'user',content:'Private operator context'};
  const saved=chat.append(input);
  assert.deepEqual(chat.get(input.id),saved);
  assert.equal(chat.get('missing'),null);
  assert.deepEqual(chat.append(input),saved);
  assert.throws(()=>chat.append({...input,content:'different'}),/CONFLICT/);
  const encrypted=bus.db.prepare('SELECT content FROM aura_chat_messages').get().content;
  assert.ok(encrypted.startsWith('jacoenc1:'));assert.equal(encrypted.includes(input.content),false);
  bus.close();bus=new DurableMissionBus(dir);chat=createAuraChatSession(bus);
  assert.deepEqual(chat.list(),[saved]);
});

test('corruption or a lost installation key fails explicitly rather than returning an empty history',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aura-chat-failure-'));const bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  const chat=createAuraChatSession(bus);chat.append({id:'m1',role:'assistant',content:'Verified answer'});
  bus.db.prepare('UPDATE aura_chat_messages SET content=?').run('jacoenc1:broken');
  assert.throws(()=>chat.list(),/AUTHENTICATION_FAILED/);
  fs.unlinkSync(path.join(bus.stateDir,'aura-chat','content.key'));
  assert.throws(()=>createAuraChatSession(bus),/CONTENT_KEY_MISSING/);
});

test('message attachments are resolved from stored uploads, encrypted and retained across reopen',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-chat-refs-'));let bus=new DurableMissionBus(root);
 t.after(()=>{bus.close();fs.rmSync(root,{recursive:true,force:true});});
 const id='12345678-1234-1234-1234-123456789abc';
 const resolveAttachments=ids=>ids.map(id=>({id,name:'Verified upload',fileCount:3}));
 let chat=createAuraChatSession(bus,{resolveAttachments});
 const input={id:'upload-message',role:'user',content:'Read these files',attachments:[{id,name:'forged label',fileCount:999}]};
 const saved=chat.append(input);assert.equal(saved.attachments[0].name,'Verified upload');assert.equal(saved.attachments[0].fileCount,3);
 assert.deepEqual(chat.append(input),saved);
 assert.throws(()=>chat.append({...input,attachments:[]}),/CONFLICT/);
 assert.throws(()=>chat.append({...input,id:'invalid',attachments:[{id:'../../root'}]}),/ATTACHMENTS_INVALID/);
 const encrypted=bus.db.prepare('SELECT content FROM aura_chat_messages').get().content;assert.ok(!encrypted.includes('Verified upload'));
 bus.close();bus=new DurableMissionBus(root);chat=createAuraChatSession(bus,{resolveAttachments});assert.deepEqual(chat.list()[0].attachments,saved.attachments);
});

test('a memory quotes the operator, survives reopen, reaches the chat context and is deleted on forget',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aura-memory-'));let bus=new DurableMissionBus(dir);
 t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
 let chat=createAuraChatSession(bus);
 chat.append({id:'said',role:'user',content:'Kom ihåg att jag dricker kaffe utan mjölk'});
 chat.append({id:'answer',role:'assistant',content:'Jag ska minnas det'});
 assert.throws(()=>chat.remember({sourceMessageId:'answer',text:'Jag ska minnas det'}),/SOURCE_INVALID/,'only the operator\'s own messages are a source');
 assert.throws(()=>chat.remember({sourceMessageId:'missing',text:'kaffe'}),/SOURCE_INVALID/);
 assert.throws(()=>chat.remember({sourceMessageId:'said',text:'jag dricker te'}),/NOT_IN_SOURCE/,'a memory cannot say what the operator did not');
 const memory=chat.remember({sourceMessageId:'said',text:'jag dricker kaffe utan mjölk'});
 assert.deepEqual(chat.remember({sourceMessageId:'said',text:'jag dricker kaffe utan mjölk'}),memory,'remembering twice keeps one memory');
 assert.equal(memory.saidAt,chat.get('said').at);
 assert.ok(!bus.db.prepare('SELECT content FROM aura_memories').get().content.includes('kaffe'),'stored encrypted');
 bus.close();bus=new DurableMissionBus(dir);chat=createAuraChatSession(bus);
 assert.deepEqual(chat.memories(),[memory]);
 const [context]=operatorMemoryContext(chat.memories());
 assert.equal(context.source,'jaco://operator-memory');assert.equal(context.content.memories[0].text,'jag dricker kaffe utan mjölk');
 assert.deepEqual(operatorMemoryContext([]),[]);
 assert.equal(chat.forget(memory.id),true);assert.equal(chat.forget(memory.id),false);
 bus.close();bus=new DurableMissionBus(dir);chat=createAuraChatSession(bus);
 assert.deepEqual(chat.memories(),[],'forgotten after restart');
 assert.ok(chat.get('said'),'forgetting does not rewrite the conversation history');
});
