// Operator-approval guard for durable Nova / Desktop AgentOS actions.
//
// Everything local and reversible stays autonomous. An action whose effect is hard to undo or is
// visible to other people stops the mission and asks the operator: recursive deletes, history
// rewrites, publishing, sending in the operator's name and signing in. The model never sees this
// as a retryable error; the mission is BLOCKED until the operator answers.
// Outgoing spend has its own guard (spendGuard.mjs). This one does not replace it.

// A rebuildable directory may be removed freely when it is named as a plain relative path.
const REBUILDABLE = /^(?:\.\/)?(?:[\w.-]+\/)*(?:node_modules|dist|build|coverage|target|\.cache|\.turbo|\.next|tmp)\/?$/;

const RECURSIVE_DELETE = [
  /(?:^|[\s;&|(])rm\s+(?:-\S+\s+)*-\S*[rR]\S*(?:\s+-\S+)*\s+([^;&|]+)/,
  /(?:^|[\s;&|(])(?:rmdir|rd)\s+\/s\b\s*(?:\/q\s+)?([^;&|]+)/i,
  /(?:^|[\s;&|(])del\s+(?:\/\w\s+)*\/s\b\s*(?:\/\w\s+)*([^;&|]+)/i,
  /\bRemove-Item\b([^;&|]*-Recurse[^;&|]*)/i,
];

const SHELL_RULES = [
  [/\bgit\s+push\b[^;&|]*\s(?:--force(?:-with-lease)?|-f)(?:\s|$)/, 'force-push rewrites shared history'],
  [/\bgit\s+push\b[^;&|]*\s(?:main|master)(?:\s|$)/, 'push directly to a protected branch'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard discards local work'],
  [/\bgit\s+clean\s+-\S*f/, 'git clean deletes untracked files'],
  [/\bgit\s+branch\s+-D\b/, 'force-delete of a git branch'],
  [/\bgh\s+(?:pr\s+merge|release\s+create|repo\s+delete)\b/, 'GitHub merge, release or repository delete'],
  [/\bgh\s+auth\b|\bnpm\s+login\b|\bwrangler\s+login\b/, 'sign-in or credential change'],
  [/\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\bwrangler\s+(?:deploy|publish)\b|\bvercel\b[^;&|]*--prod\b|\bfirebase\s+deploy\b|\bkubectl\s+(?:apply|delete)\b|\bterraform\s+(?:apply|destroy)\b/, 'publish or deploy'],
  [/\bcurl\b[^;&|]*(?:-X\s*|--request\s+)DELETE\b|\bInvoke-(?:RestMethod|WebRequest)\b[^;&|]*-Method\s+Delete\b/i, 'remote delete request'],
  [/(?:^|[\s;&|(])(?:mkfs\S*|format\s+[a-z]:|dd\s+if=|diskpart|shutdown|reg\s+delete|schtasks\s+\/delete|Stop-Computer|Restart-Computer)/i, 'system-level change'],
];

// Clickable labels: English and Swedish, because the operator's own sites and apps use both.
const CLICK_RULES = [
  [/\b(delete|remove|erase|destroy|deactivate|radera|ta bort)\b/i, 'delete in a live application'],
  [/\b(publish|deploy|go live|merge pull request|publicera|driftsätt)\b/i, 'publish or deploy'],
  [/\b(send|post|reply|tweet|share|invite|skicka|svara|dela|bjud in)\b/i, "send or post in the operator's name"],
  [/\b(sign in|log ?in|sign up|authorize|grant access|allow access|logga in|registrera|godkänn åtkomst)\b/i, 'sign-in or access grant'],
];
const CLICK_TASKS = new Set(['browser-click', 'desktop-invoke', 'desktop-action', 'mouse-click']);
const TYPE_TASKS = new Set(['browser-type', 'type-text']);

// Tool names of external connectors: only the verbs with an outside effect stop for the operator,
// so creating a draft or updating a record stays autonomous.
const MCP_WRITE = /(?:^|[_.-])(send|publish|post|reply|forward|delete|remove|trash|merge|deploy|share|invite|transfer)(?:[_.-]|$)/i;

// A path that stays inside the working directory: relative, no parent segments, and neither the
// directory itself nor its git metadata. Inside a contract the working directory is the mission's
// own git worktree, so deleting there is part of the work, not a decision for the operator.
function insideWorkingDirectory(target) {
  const t = target.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/');
  if (!t || /^(?:[A-Za-z]:|\/|~|\$|%)/.test(t)) return false;
  if (t.split('/').includes('..')) return false;
  if (/^(?:\.\/?|\*|\.\/\*)$/.test(t)) return false;
  if (/(?:^|\/)\.git(?:\/|$)/.test(t)) return false;
  return true;
}

function recursiveDelete(command, sandbox) {
  for (const pattern of RECURSIVE_DELETE) {
    const match = command.match(pattern);
    if (!match) continue;
    const targets = String(match[1]).trim().split(/\s+/).filter(t => t && !t.startsWith('-') && !/^\/[a-z]$/i.test(t));
    const clean = t => t.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/');
    const safe = targets.length && targets.every(t => REBUILDABLE.test(clean(t)) || (sandbox && insideWorkingDirectory(t)));
    if (!safe) return true;
  }
  return false;
}

function clickLabel(data = {}) {
  return [data.name, data.text, data.label, typeof data.selector === 'string' ? data.selector : JSON.stringify(data.selector || '')]
    .filter(Boolean).map(String).join(' ');
}

// What a contract's own worktree makes safe: it is a throwaway checkout on the mission's own branch,
// so discarding or deleting there loses nothing that git does not still hold.
const SANDBOX_LOCAL = new Set(['git reset --hard discards local work', 'git clean deletes untracked files']);

// Returns null when the action is autonomous, or { reason } when it needs the operator.
// sandbox: the mission runs under a contract in its own worktree. The contract is the standing
// permission for everything inside it; only what leaves it (push to a shared branch, publish,
// deploy, send, sign in, delete outside the worktree) still asks.
export function operatorApprovalCheck(task, { sandbox = false } = {}) {
  const data = task?.data || {};
  if (task?.type === 'shell') {
    const command = [data.command, ...(Array.isArray(data.args) ? data.args : [])].filter(Boolean).join(' ');
    if (recursiveDelete(command, sandbox)) return { reason: 'recursive delete' };
    const rule = SHELL_RULES.find(([pattern, reason]) => pattern.test(command) && !(sandbox && SANDBOX_LOCAL.has(reason)));
    return rule ? { reason: rule[1] } : null;
  }
  if (task?.type === 'mcp-write') {
    return MCP_WRITE.test(String(data.tool || '')) ? { reason: `external write ${data.server || 'connector'}.${data.tool}` } : null;
  }
  if (CLICK_TASKS.has(task?.type)) {
    const rule = CLICK_RULES.find(([pattern]) => pattern.test(clickLabel(data)));
    return rule ? { reason: rule[1] } : null;
  }
  if (TYPE_TASKS.has(task?.type) && /^vault:/i.test(String(data.text || ''))) return { reason: 'typing a stored credential' };
  return null;
}
