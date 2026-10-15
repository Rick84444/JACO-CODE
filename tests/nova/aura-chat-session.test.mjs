import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { createAuraChatSession } from '../../runtime/src/server/connected/auraChatSession.mjs';

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
