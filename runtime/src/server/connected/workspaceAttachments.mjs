import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { redactText } from '../../../../agents/lib/secret-capture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => {
  if (typeof value !== 'string' || value.length > 500 || /[\\\x00-\x1f:<>"|?*]/.test(value) || path.posix.isAbsolute(value)) throw Error('ATTACHMENT_PATH_INVALID');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || /[. ]$/.test(p) || /^(\.env(?:\..*)?|\.git|\.jaco|node_modules|credentials?|secrets?)(?:$|\.)/i.test(p))) throw Error('ATTACHMENT_PATH_DENIED');
  return value;
};
export function createWorkspaceAttachments(root) {
  root = path.resolve(root);
  const batchPath = id => {
    if (!/^[a-f0-9-]{36}$/.test(String(id))) throw Error('ATTACHMENT_ID_INVALID');
    return path.join(root, id);
  };
  const manifest = id => {
    const base = batchPath(id);
    if (fs.lstatSync(base).isSymbolicLink() || fs.lstatSync(path.join(base,'manifest.json')).isSymbolicLink()) throw Error('ATTACHMENT_LINK_DENIED');
    return JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  };
  return {
    create(files) {
      if (!Array.isArray(files) || !files.length || files.length > 200) throw Error('ATTACHMENT_FILES_LIMIT_200');
      let total = 0;
      const seen = new Set();
      const prepared = files.map(file => {
        const name = safePath(file.path);
        if (seen.has(name.toLowerCase())) throw Error('ATTACHMENT_DUPLICATE_PATH');
        seen.add(name.toLowerCase());
        if (typeof file.base64 !== 'string' || file.base64.length > 8000000) throw Error('ATTACHMENT_SIZE_LIMIT_6MB_FILE');
        if (file.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw Error('ATTACHMENT_ENCODING_INVALID');
        const bytes = Buffer.from(file.base64, 'base64');
        if (bytes.toString('base64') !== file.base64) throw Error('ATTACHMENT_ENCODING_INVALID');
        total += bytes.length;
        if (bytes.length > 6_000_000 || total > 6_000_000) throw Error('ATTACHMENT_SIZE_LIMIT_6MB_BATCH');
        let text = null;
        try { text = bytes.includes(0) ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {}
        return { bytes, entry: { path: name, bytes: bytes.length, sha256: digest(bytes), format: text === null ? 'binary' : 'text' } };
      });
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const id = randomUUID(), stage = path.join(root, `.${id}.tmp`);
      fs.mkdirSync(stage, { mode: 0o700 });
      try {
        for (const { bytes, entry } of prepared) {
          const file = path.join(stage, 'files', entry.path);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
        }
        const item = { schema: 'jaco.attachments/v1', id, createdAt: new Date().toISOString(), totalBytes: total, files: prepared.map(p => p.entry) };
        fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(item), { flag: 'wx', mode: 0o600 });
        fs.renameSync(stage, batchPath(id));
        return item;
      } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
    },
    manifest,
    read(id, relative, offset = 0, limit = 12000) {
      if (!relative) { const item=manifest(id), start=Math.max(0,Math.floor(Number(offset)||0)), size=Math.min(50,Math.max(1,Math.floor(Number(limit)||20))); return {id:item.id,totalFiles:item.files.length,files:item.files.slice(start,start+size),nextOffset:Math.min(item.files.length,start+size),truncated:start+size<item.files.length}; }
      const name = safePath(relative), item = manifest(id), entry = item.files.find(f => f.path === name);
      if (!entry) throw Error('ATTACHMENT_FILE_NOT_FOUND');
      const base = path.join(batchPath(id), 'files'), file = path.join(base, name);
      if(fs.lstatSync(base).isSymbolicLink())throw Error('ATTACHMENT_LINK_DENIED');
      let current = base;
      for (const part of name.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw Error('ATTACHMENT_LINK_DENIED'); }
      const bytes = fs.readFileSync(file);
      if (digest(bytes) !== entry.sha256) throw Error('ATTACHMENT_CONTENT_CHANGED');
      if (entry.format !== 'text') return { ...entry, readable: false, reason: 'BINARY_EXTRACTION_NOT_SUPPORTED' };
      const start = Math.max(0, Math.floor(Number(offset) || 0)), size = Math.min(20000, Math.max(1, Math.floor(Number(limit) || 12000)));
      const text = redactText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).text;
      const content = text.slice(start, start + size);
      return { ...entry, readable: true, offset: start, nextOffset: Math.min(text.length, start + size), truncated: start + size < text.length, content };
    },
    context(ids) {
      if (!Array.isArray(ids) || ids.length > 16) throw Error('ATTACHMENT_SELECTION_INVALID');
      return [...new Set(ids)].map(id => manifest(id));
    },
  };
}
