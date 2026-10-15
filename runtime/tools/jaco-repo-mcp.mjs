// JACO's own read-only repository MCP server (stdio, newline-delimited JSON-RPC, no dependencies).
// The Git MCP server has no way to list a commit's files without its whole diff; on 2026-10-03 a
// mission asked for the files of three commits and one diff was 51 000 characters, so the list could
// not be read. These tools answer such questions compactly. Read only: no tool changes the repository.
//   node tools/jaco-repo-mcp.mjs <repository root>
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const REV = /^[A-Za-z0-9_./~^@{}-]{1,100}$/;
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
const revision = value => {
  const rev = String(value ?? 'HEAD').trim();
  if (!REV.test(rev) || rev.startsWith('-') || rev.includes('..')) throw new Error(`invalid revision: ${rev.slice(0, 60)}`);
  return rev;
};
const count = (value, max) => Math.max(1, Math.min(max, Number.parseInt(value ?? 5, 10) || 5));

const TOOLS = [
  {
    name: 'commit_files',
    description: 'Every file one commit changed, with its status (A added, M modified, D deleted, R renamed) and line counts, plus the commit hash, date and subject. Use it instead of a full diff to know what a commit touched.',
    inputSchema: { type: 'object', properties: { revision: { type: 'string', description: 'commit hash, HEAD, HEAD~1, a branch or tag' } }, required: ['revision'] },
    run: ({ revision: rev }) => {
      const r = revision(rev);
      const head = git(['show', '-s', '--format=%H%n%ad%n%s', '--date=iso-strict', r]).trim().split('\n');
      const status = git(['show', '--format=', '--name-status', '-M', r]).trim().split('\n').filter(Boolean);
      const stats = new Map(git(['show', '--format=', '--numstat', '-M', r]).trim().split('\n').filter(Boolean)
        .map(line => { const [added, removed, ...file] = line.split('\t'); return [file.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, ''), `+${added} -${removed}`]; }));
      const files = status.map(line => { const parts = line.split('\t'); const file = parts.at(-1); return `${parts[0][0]}\t${parts.slice(1).join(' -> ')}\t${stats.get(file) || ''}`; });
      return `commit ${head[0]}\ndate ${head[1]}\nsubject ${head.slice(2).join(' ')}\nfiles ${files.length}\n${files.join('\n')}`;
    },
  },
  {
    name: 'recent_commits',
    description: 'The latest commits (hash, date, subject) with the number of files each changed and their paths. Read only.',
    inputSchema: { type: 'object', properties: { max_count: { type: 'integer', minimum: 1, maximum: 30 } } },
    run: ({ max_count }) => git(['log', `-${count(max_count, 30)}`, '--date=iso-strict', '--name-only', '--format=%ncommit %H%ndate %ad%nsubject %s']).trim(),
  },
];

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  try {
    if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-repo', version: '1.0.0' } } });
    if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS.map(({ run, ...t }) => ({ ...t, annotations: { readOnlyHint: true } })) } });
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
