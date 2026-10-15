// Built-in Git MCP for Node/Termux. No uvx, npx or shell interpreter.
// Git operations use JACO's audited, workspace-confined SafeShell.
import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SafeShell } from '../../agents/lib/safe-shell.mjs';

const tool = (name, description, readOnly, properties = {}, required = [], args) => ({
  name, description, readOnly, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) }, args,
});
const filePath = { type: 'string', description: 'Path relative to the selected workspace.' };
const TOOLS = [
  tool('git_status', 'Current branch and changed files.', true, {}, [], () => ['status', '--short', '--branch']),
  tool('git_diff_unstaged', 'Unstaged changes (bounded output).', true, {}, [], () => ['diff', '--no-ext-diff']),
  tool('git_diff_staged', 'Staged changes (bounded output).', true, {}, [], () => ['diff', '--cached', '--no-ext-diff']),
  tool('git_log', 'Recent commits.', true, { max_count: { type: 'integer', minimum: 1, maximum: 30 } }, [], a => ['log', '-n', String(Math.max(1, Math.min(30, Number(a.max_count) || 10))), '--format=%h %s']),
  tool('git_add', 'Stage one workspace file.', false, { path: filePath }, ['path'], a => ['add', '--', checkedPath(a.path)]),
  tool('git_commit', 'Commit staged changes with a message.', false, { message: { type: 'string' } }, ['message'], a => ['commit', '-m', checkedMessage(a.message)]),
  tool('git_fetch', 'Fetch origin without changing the checkout.', false, {}, [], () => ['fetch', 'origin']),
  tool('git_pull', 'Fast-forward-only update of the current checkout.', false, {}, [], () => ['pull', '--ff-only']),
  tool('git_push', 'Push current branch; requires JACO_SHELL_ALLOW_PUSH=1.', false, {}, [], () => ['push']),
];
function checkedPath(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 2048 || v.includes('\0') || v.startsWith('-')) throw Error('GIT_PATH_REQUIRED');
  return v;
}
function checkedMessage(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 500 || v.includes('\0')) throw Error('GIT_COMMIT_MESSAGE_REQUIRED');
  return v;
}
export async function handleGitMcp(msg, { shell = new SafeShell({ workspace: path.resolve(process.env.JACO_GIT_WORKSPACE || process.cwd()) }) } = {}) {
  if (!msg || msg.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-git', version: '1.0.0' } });
  if (msg.method === 'tools/list') return reply({ tools: TOOLS.map(({ args, readOnly, ...t }) => ({ ...t, annotations: { readOnlyHint: readOnly } })) });
  if (msg.method === 'ping') return reply({});
  if (msg.method !== 'tools/call') return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'METHOD_NOT_FOUND' } };
  const selected = TOOLS.find(t => t.name === msg.params?.name);
  if (!selected) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'UNKNOWN_TOOL' } };
  try {
    const args = selected.args(msg.params?.arguments || {});
    const result = await shell.run({ command: 'git', args, mode: selected.readOnly ? 'read' : 'write' });
    return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], ...(!result.ok ? { isError: true } : {}) });
  } catch (e) {
    return reply({ isError: true, content: [{ type: 'text', text: String(e?.message || e).slice(0, 240) }] });
  }
}
export { TOOLS as GIT_TOOLS };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const shell = new SafeShell({ workspace: path.resolve(process.env.JACO_GIT_WORKSPACE || process.argv[2] || process.cwd()) });
  const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
  // Serialize operations: concurrently arriving add/commit must not reorder.
  let queue = Promise.resolve();
  readline.createInterface({ input: process.stdin }).on('line', line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    queue = queue.then(async () => { const out = await handleGitMcp(msg, { shell }); if (out) send(out); })
      .catch(error => send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message || error).slice(0, 200) } }));
  });
}