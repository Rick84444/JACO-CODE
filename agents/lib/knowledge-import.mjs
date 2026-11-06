// Turns a folder of markdown pages (a GitHub wiki checkout, an Obsidian vault, a docs folder) into knowledge objects
// for the canonical knowledge store (POST /api/continuum/knowledge). This module only reads files and builds the
// objects; tools/import-knowledge.mjs sends them.
//
// Rules the import keeps:
//   - The same page always gets the same ids, so running it again updates in place; an unchanged page is untouched.
//   - Imported pages are UNVERIFIED and not reusable: a wiki is the operator's text, not proven fact.
//   - A chunk that looks like a credential is skipped and reported, never stored in searchable memory.
//   - Only text files inside the folder are read; hidden folders, node_modules and oversized files are skipped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KIND = 'wiki-page';
const PAGE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 2000;
export const MAX_CHUNK_CHARS = 5500; // the store keeps 6000 characters of reasoningSummary

// The same credential shapes the MCP knowledge note refuses (runtime/gateway/src/cognitive-context.mjs).
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[\w-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bBearer\s+[^\s,;]{8,}|(?:api.?key|password|passwd|secret|token)\s*[:=]\s*\S+/i;

export function slug(text) {
  return String(text).toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
}

export function listPages(root) {
  const base = path.resolve(root);
  const files = [];
  const skipped = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped.push({ path: path.relative(base, full), reason: 'symbolic link' }); continue; }
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || !PAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (fs.statSync(full).size > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: 'file is larger than 512 KB' }); continue; }
      if (files.length >= MAX_FILES) { skipped.push({ path: rel, reason: `more than ${MAX_FILES} pages` }); continue; }
      files.push({ rel, full });
    }
  };
  walk(base);
  return { files, skipped };
}

export function titleOf(rel, text) {
  const heading = /^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(text);
  return (heading ? heading[1] : path.basename(rel).replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ')).slice(0, 200);
}

// Splits at headings, then packs sections into chunks that fit one knowledge object.
export function chunkText(text, limit = MAX_CHUNK_CHARS) {
  const sections = String(text).replace(/\r\n/g, '\n').split(/\n(?=#{1,4}\s)/);
  const chunks = [];
  let current = '';
  const flush = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  for (const section of sections) {
    if (section.length > limit) {
      flush();
      for (let at = 0; at < section.length; at += limit) chunks.push(section.slice(at, at + limit).trim());
      continue;
    }
    if (current.length + section.length + 1 > limit) flush();
    current += (current ? '\n' : '') + section;
  }
  flush();
  return chunks.filter(Boolean);
}

/** Knowledge objects for every page under root, plus what was skipped and why. */
export function buildKnowledge(root, { source = 'wiki' } = {}) {
  const name = slug(source);
  const { files, skipped } = listPages(root);
  const objects = [];
  for (const file of files) {
    const text = fs.readFileSync(file.full, 'utf8');
    if (!text.trim()) { skipped.push({ path: file.rel, reason: 'empty page' }); continue; }
    const title = titleOf(file.rel, text);
    const chunks = chunkText(text);
    chunks.forEach((chunk, index) => {
      if (SECRET.test(chunk)) { skipped.push({ path: file.rel, part: index + 1, reason: 'looks like a credential' }); return; }
      objects.push({
        id: `wiki-${name}-${slug(file.rel)}-${crypto.createHash('sha1').update(file.rel).digest('hex').slice(0, 6)}-${index + 1}`,
        kind: KIND,
        purpose: `${title} (${file.rel}${chunks.length > 1 ? `, part ${index + 1} of ${chunks.length}` : ''})`.slice(0, 2000),
        reasoningSummary: chunk,
        confidence: 0.5,
        reusable: false,
        implementation: { source: name, path: file.rel, part: index + 1, parts: chunks.length, sha256: crypto.createHash('sha256').update(chunk).digest('hex') },
      });
    });
  }
  return { source: name, objects, skipped, pages: files.length };
}
