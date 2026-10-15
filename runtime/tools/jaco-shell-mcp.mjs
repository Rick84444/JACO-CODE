// JACO Shell: bounded commands in one folder, as an MCP server (agents/lib/safe-shell.mjs holds the rules).
// It runs on the device that owns the workspace, started by JACO's MCP host (a phone in Termux, a computer),
// so an agent that works through that device can build and test there, like on Windows, without a shell
// that interprets anything.
//   shell_info   read only: the workspace, the programs, the limits
//   shell_read   read only: look around (ls, cat, grep, git status/diff/log ...); anything that changes is refused
//   shell_run    write: build, test, edit, commit (git add/commit, npm test, node script.js ...)
// Agents get shell_read by default; the operator gives an agent shell_run by setting the server's access to
// "write" in the IDE. Destructive uses and git push need the operator's environment switches as well.
//
//   JACO_SHELL_WORKSPACE=<folder> node tools/jaco-shell-mcp.mjs      stdio (newline-delimited JSON-RPC)
import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SafeShell } from '../../agents/lib/safe-shell.mjs';

const workspace = path.resolve(process.env.JACO_SHELL_WORKSPACE || process.env.JACO_WORKSPACE_ROOT || process.cwd());
const shell = new SafeShell({ workspace });
const text = value => JSON.stringify(value, null, 2);
const argSchema = { command: { type: 'string', description: 'the program, e.g. "git" (no shell: pipes, ; && and $() are not interpreted)' }, args: { type: 'array', items: { type: 'string' }, description: 'its arguments, one string each' }, cwd: { type: 'string', description: 'folder inside the workspace (default: the workspace)' } };

const TOOLS = [
  { name: 'shell_info', readOnly: true, description: 'What this shell may run: workspace, allowed programs, limits, and whether destructive commands or push are enabled. Read only.',
    inputSchema: { type: 'object', properties: {} }, run: async () => shell.info() },
  { name: 'shell_read', readOnly: true, description: 'Run a read-only command in the workspace: ls, cat, head, tail, wc, grep, find, stat, du, file, pwd, uname, df, git status/diff/log/show/blame/ls-files, npm ls, node --version. Anything that would change something is refused. Returns stdout, stderr, exit code, timing.',
    inputSchema: { type: 'object', properties: { ...argSchema, timeoutSeconds: { type: 'number' } }, required: ['command'] },
    run: args => shell.run({ ...args, mode: 'read' }) },
  { name: 'shell_run', readOnly: false, description: 'Run a command that may change the workspace: git add/commit/switch/merge/fetch, npm test / run <script> / ci, node or python3 <script in the workspace>, mkdir, touch, cp, mv, rm (single files). Runs the project\'s own code, so it needs write access to this server. Recursive rm, git reset/clean/push and branch deletion are refused unless the operator enabled them. Returns stdout, stderr, exit code, timing.',
    inputSchema: { type: 'object', properties: { ...argSchema, timeoutSeconds: { type: 'number', description: 'default 30, at most 300' } }, required: ['command'] },
    run: args => shell.run({ ...args, mode: 'write' }) },
];

export async function handle(msg, impl = shell) {
  if (msg?.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-shell', version: '1.0.0' } });
  if (msg.method === 'tools/list') return reply({ tools: TOOLS.map(({ run, readOnly, ...t }) => ({ ...t, annotations: { readOnlyHint: Boolean(readOnly), destructiveHint: !readOnly } })) });
  if (msg.method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === msg.params?.name);
    if (!tool) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${msg.params?.name}` } };
    try {
      const result = await tool.run(msg.params?.arguments || {});
      // A refused or failed command is a normal answer the agent reads and adapts to, not a protocol error.
      return reply({ content: [{ type: 'text', text: text(result) }], ...(result?.refused ? { isError: true } : {}) });
    } catch (error) { return reply({ isError: true, content: [{ type: 'text', text: String(error?.message || error).split('\n')[0].slice(0, 300) }] }); }
  }
  if (msg.method === 'ping') return reply({});
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}
export { TOOLS };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const out = await handle(msg);
    if (out) send(out);
  });
}
