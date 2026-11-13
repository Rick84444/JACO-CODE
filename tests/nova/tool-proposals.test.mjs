// Contract: Aura may propose a tool, never install one; a proposal carries no secret; the operator's decision is
// the only thing that turns it into a server entry; and the planner task is validated like every other task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateToolProposal, serverEntryFor, proposalStore } from '../../agents/lib/tool-proposals.mjs';
import { validateTask } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { READ_ONLY_TASKS } from '../../agents/lib/approval-policy.mjs';

const git = { kind: 'mcp-git', name: 'calendar', reason: 'The plan needs to read the operator calendar and no tool does.', repoUrl: 'https://github.com/acme/mcp-calendar.git' };

test('a proposal is validated by kind and may never carry a secret value', () => {
  assert.equal(validateToolProposal(git).repoUrl, 'https://github.com/acme/mcp-calendar');
  assert.throws(() => validateToolProposal({ ...git, repoUrl: 'http://github.com/x/y' }), /HTTPS_REQUIRED/);
  assert.throws(() => validateToolProposal({ ...git, repoUrl: 'https://evil.example/x/y' }), /HOST_UNSUPPORTED/);
  assert.throws(() => validateToolProposal({ ...git, reason: 'short' }), /REASON_REQUIRED/);
  assert.throws(() => validateToolProposal({ ...git, name: 'Bad Name' }), /NAME_INVALID/);
  const cmd = { kind: 'mcp-command', name: 'files', reason: 'Read-only access to a second folder the goal names explicitly.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/data'] };
  assert.deepEqual(validateToolProposal(cmd).args, cmd.args);
  assert.throws(() => validateToolProposal({ ...cmd, command: 'bash' }), /COMMAND_UNSUPPORTED/);
  assert.throws(() => validateToolProposal({ ...cmd, args: ['-y', 'x; rm -rf /'] }), /ARGS_INVALID/);
  assert.throws(() => validateToolProposal({ ...cmd, env: { API_KEY: 'sk-live-123' } }), /ENV_MUST_BE_REFERENCE/);
  assert.deepEqual(validateToolProposal({ ...cmd, env: { API_KEY: '${NOVA_FILES_KEY}' } }).env, { API_KEY: '${NOVA_FILES_KEY}' });
  const http = { kind: 'mcp-http', name: 'weather', reason: 'The goal asks for a forecast and no connected tool answers.', url: 'https://mcp.example.org/sse', tokenEnv: 'WEATHER_TOKEN' };
  assert.equal(serverEntryFor(validateToolProposal(http)).transport, 'http');
  assert.equal(serverEntryFor(validateToolProposal(http)).agentAccess, 'read', 'an approved tool starts read-only');
  assert.equal(serverEntryFor(validateToolProposal(git)), null, 'a Git source goes through staging, not straight to a server');
});

test('the store merges the same wish from several missions and records one decision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-tools-'));
  const store = proposalStore(dir);
  const a = store.add(git, { missionId: 'm1' });
  const b = store.add({ ...git, reason: 'Still needed: the calendar step cannot start without it.' }, { missionId: 'm2' });
  assert.equal(a.id, b.id);
  assert.deepEqual(store.get(a.id).missions, ['m1', 'm2']);
  assert.equal(store.list().length, 1);
  assert.equal(store.decide(a.id, 'approve', { note: 'ok', result: { staged: 'src-1' } }).status, 'APPROVED');
  assert.throws(() => store.decide(a.id, 'reject'), /TOOL_PROPOSAL_APPROVED/);
  assert.throws(() => store.decide('tool-missing', 'approve'), /NOT_FOUND/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('propose-tool is a mission task: validated before it runs, read-only for approval policy, and refused when not granted', () => {
  const ok = validateTask({ type: 'propose-tool', data: git }, ['propose-tool']);
  assert.equal(ok.type, 'propose-tool');
  assert.throws(() => validateTask({ type: 'propose-tool', data: { ...git, repoUrl: 'ftp://x' } }, ['propose-tool']), /HTTPS_REQUIRED/);
  assert.throws(() => validateTask({ type: 'propose-tool', data: git }, ['web-fetch']), /TASK_NOT_ALLOWED/);
  assert.ok(READ_ONLY_TASKS.has('propose-tool'), 'a proposal changes nothing and needs no gate of its own');
});
