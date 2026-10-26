import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateContent } from '../../../../gateway/src/workplace/private-content.mjs';

// The existing runtime database owns conversation state. Reuse Workplace's authenticated
// encryption format; neither messages nor the installation key belong in Git or localStorage.
export function createAuraChatSession(bus, { resolveAttachments = null } = {}) {
  const stateDir = path.join(bus.stateDir, 'aura-chat');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const codec = privateContent(stateDir);
  bus.db.exec('CREATE TABLE IF NOT EXISTS aura_chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,at TEXT NOT NULL,content TEXT NOT NULL)');
  // What the operator asked Aura to remember. Each memory quotes the operator's own message it came from,
  // so nothing is remembered that the operator did not say, and forgetting deletes the row (secure_delete
  // overwrites the freed pages) instead of marking it hidden. The source message itself stays in the history.
  bus.db.exec('CREATE TABLE IF NOT EXISTS aura_memories (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,source_id TEXT NOT NULL,at TEXT NOT NULL,content TEXT NOT NULL)');
  bus.db.exec('PRAGMA secure_delete=ON');
  fs.writeFileSync(path.join(stateDir, 'content.encrypted'), 'jaco.aura-chat/v1', { mode: 0o600 });
  const session = {
    get(id) {
      if (typeof id !== 'string') return null;
      const existing = bus.db.prepare('SELECT content FROM aura_chat_messages WHERE id=?').get(id);
      return existing ? JSON.parse(codec.open(existing.content)) : null;
    },
    list() {
      return bus.db.prepare('SELECT content FROM (SELECT seq,content FROM aura_chat_messages ORDER BY seq DESC LIMIT 200) ORDER BY seq').all().map(row => JSON.parse(codec.open(row.content)));
    },
    append(input) {
      if (!input || typeof input.id !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(input.id) || !['user','assistant','system'].includes(input.role) || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 100000) throw Error('AURA_CHAT_MESSAGE_INVALID');
      if(input.attachments !== undefined && (!Array.isArray(input.attachments)||input.attachments.length>16||input.attachments.some(item=>typeof item?.id!=='string'||!/^[a-f0-9-]{36}$/.test(item.id))))throw Error('AURA_CHAT_ATTACHMENTS_INVALID');
      const ids=[...new Set((input.attachments||[]).map(item=>item.id))];
      const existing = bus.db.prepare('SELECT content FROM aura_chat_messages WHERE id=?').get(input.id);
      if (existing) {
        const saved = JSON.parse(codec.open(existing.content));
        if (saved.content !== input.content || saved.role !== input.role || JSON.stringify((saved.attachments||[]).map(item=>item.id))!==JSON.stringify(ids)) throw Error('AURA_CHAT_MESSAGE_CONFLICT');
        return saved;
      }
      if(ids.length&&!resolveAttachments)throw Error('AURA_CHAT_ATTACHMENTS_UNAVAILABLE');
      const attachments=ids.length?resolveAttachments(ids):[];
      const message = { ...(attachments.length?{attachments}:{}), id: input.id, role: input.role, content: input.content, meta: String(input.meta || '').slice(0,2000), at: new Date().toISOString() };
      bus.db.prepare('INSERT INTO aura_chat_messages(id,at,content) VALUES(?,?,?)').run(message.id,message.at,codec.seal(JSON.stringify(message)));
      return message;
    },
    remember({ sourceMessageId, text } = {}) {
      const source = session.get(sourceMessageId);
      if (!source || source.role !== 'user') throw Error('AURA_MEMORY_SOURCE_INVALID');
      const quoted = String(text ?? '').trim();
      if (!quoted || quoted.length > 2000 || !source.content.includes(quoted)) throw Error('AURA_MEMORY_NOT_IN_SOURCE');
      const existing = session.memories().find(memory => memory.sourceMessageId === source.id && memory.text === quoted);
      if (existing) return existing;
      const memory = { id: randomUUID(), text: quoted, sourceMessageId: source.id, saidAt: source.at, at: new Date().toISOString() };
      bus.db.prepare('INSERT INTO aura_memories(id,source_id,at,content) VALUES(?,?,?,?)').run(memory.id, source.id, memory.at, codec.seal(JSON.stringify(memory)));
      return memory;
    },
    memories() {
      return bus.db.prepare('SELECT content FROM aura_memories ORDER BY seq').all().map(row => JSON.parse(codec.open(row.content)));
    },
    forget(id) {
      if (typeof id !== 'string') return false;
      return bus.db.prepare('DELETE FROM aura_memories WHERE id=?').run(id).changes > 0;
    },
  };
  return session;
}

// Added on the server to every chat request, so the same memories reach whichever model answers.
export function operatorMemoryContext(memories) {
  if (!memories.length) return [];
  return [{
    source: 'jaco://operator-memory',
    content: {
      memories: memories.slice(-200).map(memory => ({ id: memory.id, text: memory.text, saidAt: memory.saidAt })),
      instruction: 'The operator asked you to remember these, in their own words, with the time they said it. Use them when relevant and say when the operator told you. These are the only things you remember about the operator: never claim to remember anything else.',
    },
  }];
}
