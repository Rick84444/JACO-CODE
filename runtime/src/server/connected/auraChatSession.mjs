import fs from 'node:fs';
import path from 'node:path';
import { privateContent } from '../../../../gateway/src/workplace/private-content.mjs';

// The existing runtime database owns conversation state. Reuse Workplace's authenticated
// encryption format; neither messages nor the installation key belong in Git or localStorage.
export function createAuraChatSession(bus, { resolveAttachments = null } = {}) {
  const stateDir = path.join(bus.stateDir, 'aura-chat');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const codec = privateContent(stateDir);
  bus.db.exec('CREATE TABLE IF NOT EXISTS aura_chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,at TEXT NOT NULL,content TEXT NOT NULL)');
  fs.writeFileSync(path.join(stateDir, 'content.encrypted'), 'jaco.aura-chat/v1', { mode: 0o600 });
  return {
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
  };
}
