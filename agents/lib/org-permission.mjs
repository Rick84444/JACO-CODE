// The runtime check of the operator's organization mandates, shared by the runtime (Aura's tools) and Nova, which runs
// in its own process. The store and its editing belong to runtime/src/server/connected/agentOrganization.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPERATOR = 'operator';

// Tasks that are not listed only observe the machine or have their own hard gate (vault, spend, secrets).
export const TASK_PERMISSIONS = Object.freeze({
  'repo-list': 'files.read', 'repo-read': 'files.read', 'repo-scan': 'files.read', 'git-status': 'files.read', 'git-diff': 'files.read', 'skill-load': 'files.read',
  'repo-write': 'files.write', 'repo-edit': 'files.write',
  shell: 'commands.run', 'repo-test': 'commands.run', 'repo-service': 'commands.run', 'invoke-worker': 'commands.run', 'mcp-write': 'commands.run',
  'desktop-invoke': 'commands.run', 'mouse-move': 'commands.run', 'mouse-click': 'commands.run', 'mouse-scroll': 'commands.run', 'key-press': 'commands.run', 'type-text': 'commands.run',
  'android-begin': 'commands.run', 'android-target': 'commands.run', 'android-open-app': 'commands.run', 'android-tap': 'commands.run', 'android-type': 'commands.run',
  'android-scroll': 'commands.run', 'android-back': 'commands.run', 'android-home': 'commands.run',
  'git-commit': 'git.branch', 'git-push': 'git.branch', 'git-merge': 'git.merge',
  'github-create-repo': 'publish', 'promote-hf': 'publish',
  'browser-survey-site': 'browser', 'web-fetch': 'web.read', 'browser-click': 'browser', 'browser-type': 'browser',
  'email-inbox': 'mail.receive',
});

// Aura's chat tools. Tools that are not listed read runtime status or have their own operator gate.
export const AURA_TOOL_PERMISSIONS = Object.freeze({
  repo_list: 'files.read', repo_read: 'files.read', git_status: 'files.read', git_log: 'files.read', seer_memory: 'files.read', attachment_read: 'files.read', env_keys: 'files.read',
  web_fetch: 'web.read', git_pr: 'web.read', nova_deliver: 'git.merge', stack_repair: 'commands.run',
});

// The agent and everyone above it must be active and hold an unexpired grant: revoking a manager stops the whole branch.
export function authorizeChain(agents, id, key, now = new Date().toISOString()) {
  if (!agents?.[id]) return { allowed: false, reason: 'AGENT_NOT_FOUND' };
  const seen = [];
  for (let at = id; at !== OPERATOR; at = agents[at].reportsTo) {
    const agent = agents[at];
    if (!agent) return { allowed: false, reason: 'MANAGER_NOT_FOUND', at };
    if (seen.includes(at) || seen.length > 32) throw new Error('ORGANIZATION_CYCLE');
    seen.push(at);
    if (agent.status !== 'active') return { allowed: false, reason: at === id ? 'AGENT_NOT_ACTIVE' : 'MANAGER_NOT_ACTIVE', at };
    const grant = agent.mandate?.permissions?.[key];
    if (!grant) return { allowed: false, reason: at === id ? 'PERMISSION_NOT_GRANTED' : 'MANAGER_LACKS_PERMISSION', at };
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(now)) return { allowed: false, reason: 'GRANT_EXPIRED', at };
  }
  return { allowed: true };
}

export const mandateDenied = (id, key, check) => new Error(`MANDATE_DENIED:${id}:${key}:${check.reason}`);

const organizationFile = env => path.join(path.resolve(env.JACO_STATE_DIR || os.homedir()), ...(env.JACO_STATE_DIR ? [] : ['.jaco']), 'org', 'organization.json');

// Nova's check before a task runs. Read on every task so a change in the panel applies without a restart. An installation
// that has no organization, or has not put this agent in it, is not restricted; a store that cannot be read stops the work.
export function assertTaskMandate(taskType, { env = process.env, agentId = env.JACO_AURA_UNIFIED_RUNTIME === '1' || env.JACO_LITE === '1' ? 'aura' : 'nova', now } = {}) {
  const key = TASK_PERMISSIONS[taskType];
  if (!key) return;
  let text;
  try { text = fs.readFileSync(organizationFile(env), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw new Error('MANDATE_DENIED:ORGANIZATION_UNREADABLE'); }
  let agents;
  try { agents = JSON.parse(text).agents; } catch { throw new Error('MANDATE_DENIED:ORGANIZATION_UNREADABLE'); }
  if (!agents?.[agentId]) return;
  const check = authorizeChain(agents, agentId, key, now);
  if (!check.allowed) throw mandateDenied(agentId, key, check);
}
