// What Aura may use. Everything is on from the start; the operator unticks what they do not want.
// This is the one owner of the task and skill switches. MCP servers keep their own access and deny
// list (stdioMcpHost.setAccess); this file only describes them to the operator in one place.
//
// What is not a switch: outgoing payments and new financial commitments always need the operator
// (spendGuard.mjs), and so do actions that leave a contract's sandbox (operatorActionGuard.mjs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CAPABILITY_SCHEMA = 'jaco.capabilities/v1';

// Operator-facing grouping of the mission task types (agents/lib/task-fields.mjs).
export const TASK_GROUPS = [
  ['files', 'Files and code', 'Read, create, edit and test the files in your project.'],
  ['git', 'Saving and sharing versions', 'Git and GitHub: save versions of the work, share them, create repositories.'],
  ['shell', 'Running commands', 'Run programs and commands, the way a developer uses a terminal.'],
  ['web', 'Browsing the web', 'Open pages, read them, and click and type in the browser.'],
  ['desktop', 'Controlling this computer', 'Look at your windows, move the mouse, click and type like you would.'],
  ['android', 'Controlling your phone', 'Use a connected Android phone.'],
  ['tools', 'Tools and skills', 'Use the connected tools (MCP) and the ready-made skills.'],
  ['secrets', 'Passwords and e-mail', 'Create and use stored passwords and keys, read the e-mail Aura has been given.'],
  ['system', 'Checking that things work', 'Look at what is available and whether it is healthy.'],
];

const GROUP_OF = {
  files: ['repo-list', 'repo-read', 'repo-write', 'repo-edit', 'repo-test', 'repo-service', 'repo-scan'],
  git: ['git-status', 'git-diff', 'git-commit', 'git-push', 'git-merge', 'github-create-repo'],
  shell: ['shell', 'invoke-worker'],
  web: ['web-fetch', 'browser-survey-site', 'browser-click', 'browser-type'],
  desktop: ['desktop-windows', 'desktop-observe', 'desktop-action', 'desktop-invoke', 'windows-wmi-read', 'screenshot',
    'mouse-move', 'mouse-click', 'mouse-scroll', 'key-press', 'type-text', 'get-cursor'],
  android: ['android-status', 'android-observe', 'android-begin', 'android-target', 'android-open-app', 'android-tap',
    'android-type', 'android-scroll', 'android-back', 'android-home'],
  tools: ['mcp-call', 'mcp-write', 'skill-load'],
  secrets: ['vault-generate-secret', 'vault-get-secret', 'vault-list-secrets', 'secret-store', 'email-inbox'],
  system: ['detect-surfaces', 'health-check', 'check-revenue', 'promote-hf'],
};

const LABEL = {
  'repo-list': 'List files', 'repo-read': 'Read files', 'repo-write': 'Create files', 'repo-edit': 'Edit files',
  'repo-test': 'Run tests', 'repo-service': 'Start project services', 'repo-scan': 'Scan a public repository (paid)',
  'git-status': 'Git status', 'git-diff': 'Git diff', 'git-commit': 'Commit', 'git-push': 'Push', 'git-merge': 'Merge',
  'github-create-repo': 'Create a GitHub repository',
  shell: 'Run commands', 'invoke-worker': 'Start a worker',
  'web-fetch': 'Fetch a web page', 'browser-survey-site': 'Read a browser tab', 'browser-click': 'Click in the browser',
  'browser-type': 'Type in the browser',
  'desktop-windows': 'List windows', 'desktop-observe': 'Observe a window', 'desktop-action': 'Act in a window',
  'desktop-invoke': 'Invoke a control', 'windows-wmi-read': 'Read Windows system info', screenshot: 'Take a screenshot',
  'mouse-move': 'Move the mouse', 'mouse-click': 'Click the mouse', 'mouse-scroll': 'Scroll', 'key-press': 'Press keys',
  'type-text': 'Type text', 'get-cursor': 'Read the cursor position',
  'mcp-call': 'Call an MCP tool (read)', 'mcp-write': 'Call an MCP tool (write)', 'skill-load': 'Use a skill',
  'vault-generate-secret': 'Generate a secret', 'vault-get-secret': 'Use a stored secret', 'vault-list-secrets': 'List secret names',
  'secret-store': 'Store a secret', 'email-inbox': 'Read the agent inbox',
  'detect-surfaces': 'Detect what is available', 'health-check': 'Health check', 'check-revenue': 'Check revenue', 'promote-hf': 'Promote on Hugging Face',
};
const label = id => LABEL[id] || id.replace(/^android-/, 'Android ').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

export const ALWAYS_ASK = [
  { id: 'spend', label: 'Outgoing payments and new financial commitments', why: 'Money leaving your accounts always needs your decision.' },
  { id: 'leaving-sandbox', label: 'Leaving the contract sandbox', why: 'Pushing a shared branch, publishing, deploying, sending in your name, signing in, deleting outside the worktree.' },
];

export function taskCatalog(taskIds) {
  const known = new Set(taskIds);
  const grouped = new Set();
  const groups = TASK_GROUPS.map(([id, name, description]) => {
    const tasks = (GROUP_OF[id] || []).filter(t => known.has(t));
    tasks.forEach(t => grouped.add(t));
    return { id, name, description, tasks: tasks.map(t => ({ id: t, label: label(t) })) };
  });
  // A task type added later is listed, never silently hidden from the operator.
  const rest = [...known].filter(t => !grouped.has(t));
  if (rest.length) groups.push({ id: 'other', name: 'Other', description: '', tasks: rest.map(t => ({ id: t, label: label(t) })) });
  return groups.filter(g => g.tasks.length);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;

export class CapabilityPolicy {
  constructor(file, { taskIds = [] } = {}) {
    this.file = file;
    this.taskIds = new Set(taskIds);
    this.state = this.#read();
  }

  #read() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.schema === CAPABILITY_SCHEMA) {
        return {
          disabledTasks: [...new Set((saved.disabledTasks || []).filter(t => typeof t === 'string'))],
          disabledSkills: [...new Set((saved.disabledSkills || []).filter(t => typeof t === 'string' && ID.test(t)))],
          updatedAt: saved.updatedAt || null,
        };
      }
    } catch { /* a missing or damaged file means the default: everything on */ }
    return { disabledTasks: [], disabledSkills: [], updatedAt: null };
  }

  snapshot() { return { schema: CAPABILITY_SCHEMA, ...this.state }; }
  isTaskEnabled(id) { return !this.state.disabledTasks.includes(id); }
  isSkillEnabled(id) { return !this.state.disabledSkills.includes(id); }
  enabledTasks(ids) { return ids.filter(id => this.isTaskEnabled(id)); }

  // changes: { tasks: { 'repo-write': false, ... }, skills: { 'repo-insight': true, ... } } — true turns on, false off.
  update({ tasks = {}, skills = {} } = {}, by = 'operator') {
    const apply = (list, changes, valid) => {
      const set = new Set(list);
      for (const [id, on] of Object.entries(changes || {})) {
        if (typeof on !== 'boolean' || !valid(id)) throw new Error(`CAPABILITY_INVALID:${String(id).slice(0, 60)}`);
        if (on) set.delete(id); else set.add(id);
      }
      return [...set].sort();
    };
    const next = {
      disabledTasks: apply(this.state.disabledTasks, tasks, id => this.taskIds.has(id)),
      disabledSkills: apply(this.state.disabledSkills, skills, id => ID.test(id)),
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ schema: CAPABILITY_SCHEMA, ...next, by }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.state = next;
    return this.snapshot();
  }

  reset(by = 'operator') {
    return this.update({ tasks: Object.fromEntries(this.state.disabledTasks.map(t => [t, true])),
      skills: Object.fromEntries(this.state.disabledSkills.map(s => [s, true])) }, by);
  }
}
