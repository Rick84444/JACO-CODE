import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStackRepair, starterEnvironment, STACK_REPAIR_COOLDOWN_MS } from '../../runtime/src/server/connected/stackRepair.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';
import { AURA_TOOL_PERMISSIONS } from '../../agents/lib/org-permission.mjs';
import { linkDependencies, unlinkDependencies } from '../../agents/lib/mission-worktree.mjs';

const installRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-repair-'));
  fs.mkdirSync(path.join(root, 'agents', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'lib', 'local-stack.mjs'), '');
  return root;
};
const receipt = { schema: 'jaco.local-startup/v1', state: 'READY', chrome: 'READY', browserAttachment: 'READY', services: [{ id: 'cdp', state: 'READY', url: 'http://127.0.0.1:2996/health' }], warnings: [] };

test('stack repair reruns the canonical starter without this process\'s secrets and reads its receipt', async () => {
  const root = installRoot(), calls = [];
  let clock = 1_000_000;
  const env = { JACO_INSTALL_ROOT: root, PATH: '/bin', GATEWAY_TOKEN: 'secret-token-value-123456789', GITHUB_TOKEN: 'ghp_x', SystemRoot: 'C:\\Windows' };
  const run = (cmd, args, options, done) => { calls.push({ cmd, args, options }); done(null, `STARTED cdp PID=1\nREADY cdp\n${JSON.stringify(receipt, null, 2)}\n`, ''); };
  const repair = createStackRepair({ env, run, now: () => clock, execPath: 'node' });
  const result = await repair();
  assert.equal(result.repaired, true);
  assert.deepEqual(result.services, [{ id: 'cdp', state: 'READY' }]);
  assert.deepEqual(calls[0].args, [path.join(root, 'agents', 'lib', 'local-stack.mjs')]);
  assert.equal(calls[0].options.cwd, root);
  assert.equal(calls[0].options.env.GATEWAY_TOKEN, undefined, 'the starter reads secrets from .env itself');
  assert.equal(calls[0].options.env.GITHUB_TOKEN, undefined);
  assert.equal(calls[0].options.env.PATH, '/bin');
  // At most once a minute, so a looping model cannot hammer the machine.
  assert.equal((await repair()).reason, 'REPAIR_COOLDOWN');
  clock += STACK_REPAIR_COOLDOWN_MS;
  await repair();
  assert.equal(calls.length, 2);
});

test('stack repair reports a failed starter honestly and refuses where it does not apply', async () => {
  const root = installRoot();
  const failed = createStackRepair({ env: { JACO_INSTALL_ROOT: root }, run: (c, a, o, done) => done(new Error('exit 1'), '', 'EMERGENCY_STOP_ACTIVE\n') });
  assert.deepEqual(await failed(), { repaired: false, reason: 'STARTER_FAILED', detail: 'EMERGENCY_STOP_ACTIVE' });
  assert.equal((await createStackRepair({ env: {} })()).reason, 'STARTER_NOT_FOUND');
  assert.equal((await createStackRepair({ env: { PREFIX: '/data/data/com.termux/files/usr', JACO_INSTALL_ROOT: root } })()).reason, 'TERMUX_USES_RUNIT');
  assert.deepEqual(Object.keys(starterEnvironment({ Path: 'x', OPENAI_API_KEY: 'y', JACO_DATA_DIR: 'd' })), ['Path', 'JACO_DATA_DIR']);
});

test('Aura can repair in conversation, gated by her commands.run mandate, and still cannot start missions there', () => {
  assert.equal(AURA_TOOL_PERMISSIONS.stack_repair, 'commands.run');
  const toolbox = cognitiveQuestionToolbox({ tools: { stack_repair: { run: async () => ({}) }, start_goal: { run: () => assert.fail('mutation') } } }, () => ({}));
  assert.ok('stack_repair' in toolbox.tools);
  assert.equal(toolbox.tools.start_goal, undefined);
});

test('a mission worktree borrows the project packages and the link is removed before the worktree', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-link-'));
  const project = path.join(base, 'project'), target = path.join(base, 'worktree');
  fs.mkdirSync(path.join(project, 'node_modules', 'dotenv'), { recursive: true });
  fs.writeFileSync(path.join(project, 'node_modules', 'dotenv', 'index.js'), 'module.exports = 1;');
  fs.mkdirSync(path.join(target, 'runtime'), { recursive: true });
  assert.deepEqual(linkDependencies(project, target), ['node_modules']);
  assert.ok(fs.existsSync(path.join(target, 'node_modules', 'dotenv', 'index.js')));
  assert.deepEqual(linkDependencies(project, target), [], 'idempotent');
  unlinkDependencies(target);
  assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
  assert.ok(fs.existsSync(path.join(project, 'node_modules', 'dotenv', 'index.js')), 'the project keeps its packages');
});

test('Aura drives her own browser through the loopback bridge; remote HTTP MCP writes stay refused', async () => {
  const { agentRefusal, defaultServers } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');
  const browser = defaultServers({ repoRoot: process.cwd(), runtimeRoot: path.join(process.cwd(), 'runtime') }).browser;
  assert.equal(browser.transport, 'http');
  assert.match(browser.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(agentRefusal({ id: 'browser', ...browser }, { name: 'nova_navigate', readOnly: false }), null);
  assert.equal(agentRefusal({ id: 'remote', transport: 'http', url: 'https://example.com/mcp', agentAccess: 'write' }, { name: 'do', readOnly: false }), 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY');
  assert.equal(agentRefusal({ id: 'x', transport: 'http', url: 'https://example.com/mcp', agentAccess: 'write', localBridge: true }, { name: 'do', readOnly: false }), 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY', 'the flag alone does not trust a non-loopback url');
});
