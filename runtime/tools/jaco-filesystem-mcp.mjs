// JACO's own filesystem MCP server (stdio, newline-delimited JSON-RPC, no dependencies).
// The default filesystem server used to start through `npx -y @modelcontextprotocol/server-filesystem`:
// it needed network and npm on first use, ran an unpinned package, and failed on an offline install.
// This server runs on JACO's bundled Node and keeps the same tool names, so plans, notes and access
// settings that refer to them keep working.
//
// Every path is confined to one root, also through symbolic links. Reading tools declare readOnlyHint;
// the host's per-server access (read/write/off) still decides whether an agent may run the others.
//   node tools/jaco-filesystem-mcp.mjs <root>
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

const root = fs.realpathSync(path.resolve(process.argv[2] || process.cwd()));
const MAX_READ = 2 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const PROTECTED = /(^|[\\/])(\.env(\.[^\\/]*)?|\.git|node_modules)([\\/]|$)|secret|credential/i;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const inside = target => target === root || target.startsWith(root + path.sep);
// The deepest existing ancestor is resolved through links, so a link pointing outside the root is refused
// even when the final file does not exist yet.
function confined(value, { write = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('path is required');
  const absolute = path.resolve(root, value);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = path.join(fs.realpathSync(existing), path.relative(existing, absolute));
  if (!inside(real)) throw new Error(`access denied: ${value} is outside ${root}`);
  if (write && PROTECTED.test(path.relative(root, real))) throw new Error(`access denied: ${value} is protected`);
  return real;
}
const rel = p => path.relative(root, p).split(path.sep).join('/') || '.';
function readText(file, head, tail) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${rel(file)} is not a file`);
  if (stat.size > MAX_READ && !head && !tail) throw new Error(`${rel(file)} is ${stat.size} bytes; use head or tail`);
  const text = fs.readFileSync(file, 'utf8');
  if (head) return text.split(/\r?\n/).slice(0, head).join('\n');
  if (tail) return text.split(/\r?\n/).slice(-tail).join('\n');
  return text;
}
const glob = pattern => new RegExp('^' + String(pattern).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
function walk(dir, visit, depth = 0, budget = { n: 0 }) {
  if (depth > 20) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (budget.n++ >= MAX_ENTRIES) return;
    const full = path.join(dir, entry.name);
    if (visit(full, entry) === false) continue;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.isSymbolicLink()) walk(full, visit, depth + 1, budget);
  }
}

const TOOLS = [
  { name: 'read_text_file', readOnly: true, description: 'Read a text file under the root. Optional head or tail limits the number of lines.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, head: { type: 'integer', minimum: 1 }, tail: { type: 'integer', minimum: 1 } }, required: ['path'] },
    run: a => readText(confined(a.path), a.head, a.tail) },
  { name: 'read_file', readOnly: true, description: 'Read a text file under the root (same as read_text_file).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, head: { type: 'integer' }, tail: { type: 'integer' } }, required: ['path'] },
    run: a => readText(confined(a.path), a.head, a.tail) },
  { name: 'read_multiple_files', readOnly: true, description: 'Read several text files at once; a file that fails is reported, the others are returned.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, required: ['paths'] },
    run: a => (Array.isArray(a.paths) ? a.paths.slice(0, 20) : []).map(p => { try { return `${p}:\n${readText(confined(p))}`; } catch (e) { return `${p}: Error - ${e.message}`; } }).join('\n---\n') },
  { name: 'list_directory', readOnly: true, description: 'List a directory: [DIR] and [FILE] entries.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: a => fs.readdirSync(confined(a.path), { withFileTypes: true }).slice(0, MAX_ENTRIES).map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n') },
  { name: 'directory_tree', readOnly: true, description: 'Recursive tree of a directory as indented lines (skips .git and node_modules).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: a => { const base = confined(a.path); const lines = []; walk(base, (full, e) => { lines.push(`${'  '.repeat(path.relative(base, full).split(path.sep).length - 1)}${e.name}${e.isDirectory() ? '/' : ''}`); }); return lines.join('\n') || '(empty)'; } },
  { name: 'search_files', readOnly: true, description: 'Find files and directories whose name matches a pattern (* wildcard, case-insensitive) below a path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } }, required: ['path', 'pattern'] },
    run: a => { const re = glob(String(a.pattern).includes('*') ? a.pattern : `*${a.pattern}*`); const hits = []; walk(confined(a.path), (full, e) => { if (re.test(e.name)) hits.push(rel(full)); }); return hits.join('\n') || 'No matches found'; } },
  { name: 'get_file_info', readOnly: true, description: 'Size, type and timestamps of a file or directory.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: a => { const s = fs.statSync(confined(a.path)); return `type: ${s.isDirectory() ? 'directory' : 'file'}\nsize: ${s.size}\nmodified: ${s.mtime.toISOString()}\ncreated: ${s.birthtime.toISOString()}`; } },
  { name: 'list_allowed_directories', readOnly: true, description: 'The directory this server may access.',
    inputSchema: { type: 'object', properties: {} }, run: () => `Allowed directories:\n${root}` },
  { name: 'write_file', readOnly: false, description: 'Create or overwrite a text file under the root.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: a => { const file = confined(a.path, { write: true }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(a.content ?? '')); return `Wrote ${rel(file)}`; } },
  { name: 'edit_file', readOnly: false, description: 'Replace exact text in a file. Each edit replaces one occurrence of oldText with newText; an edit whose oldText is missing or ambiguous fails and nothing is written.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } }, dryRun: { type: 'boolean' } }, required: ['path', 'edits'] },
    run: a => {
      const file = confined(a.path, { write: true });
      let text = fs.readFileSync(file, 'utf8');
      for (const [i, e] of (Array.isArray(a.edits) ? a.edits : []).entries()) {
        const first = text.indexOf(String(e.oldText));
        if (!e.oldText || first < 0) throw new Error(`edit ${i + 1}: oldText not found`);
        if (text.indexOf(String(e.oldText), first + 1) >= 0) throw new Error(`edit ${i + 1}: oldText occurs more than once`);
        text = text.slice(0, first) + String(e.newText) + text.slice(first + String(e.oldText).length);
      }
      if (a.dryRun) return `Dry run: ${a.edits.length} edit(s) apply cleanly to ${rel(file)}`;
      fs.writeFileSync(file, text);
      return `Edited ${rel(file)} (${a.edits.length} edit(s))`;
    } },
  { name: 'create_directory', readOnly: false, description: 'Create a directory (and parents) under the root.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: a => { const dir = confined(a.path, { write: true }); fs.mkdirSync(dir, { recursive: true }); return `Created ${rel(dir)}`; } },
  { name: 'move_file', readOnly: false, description: 'Move or rename a file or directory under the root. Fails if the destination exists.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source', 'destination'] },
    run: a => { const from = confined(a.source, { write: true }), to = confined(a.destination, { write: true }); if (fs.existsSync(to)) throw new Error(`${rel(to)} already exists`); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); return `Moved ${rel(from)} to ${rel(to)}`; } },
];

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  try {
    if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-filesystem', version: '1.0.0' } } });
    if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS.map(({ run, readOnly, ...t }) => ({ ...t, annotations: { readOnlyHint: readOnly } })) } });
    if (msg.method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${msg.params?.name}` } });
      try { return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: tool.run(msg.params?.arguments || {}) }] } }); }
      catch (error) { return send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: String(error?.message || error).split('\n')[0].slice(0, 300) }] } }); }
    }
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message || error).slice(0, 300) } });
  }
});
