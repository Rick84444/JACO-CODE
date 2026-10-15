// Required data fields per Nova task type. Shared by the runtime (validateTask) and the planner
// (assertPlanTaskAllowed), so a plan with a missing field is rejected before it costs a mission failure.
export const TASK_FIELDS = {
  'detect-surfaces': [], 'health-check': [], 'check-revenue': [],
  'browser-survey-site': ['url'], 'browser-click': ['name'],
  // Read-only HTTP GET for research; no method/body/headers, so it cannot post or pay.
  'web-fetch': ['url'],
  'browser-type': ['name', 'text'], 'desktop-windows': [],
  'desktop-observe': [], 'desktop-action': ['action'],
  'android-status': [], 'android-observe': [], 'android-begin': ['intent'],
  'android-target': ['semanticPurpose'], 'android-open-app': ['packageName'],
  'android-tap': [], 'android-type': ['text'], 'android-scroll': ['direction'],
  'android-back': [], 'android-home': [],
  'desktop-invoke': ['hwnd', 'selector'], 'windows-wmi-read': ['query'], 'screenshot': [],
  'mouse-move': ['x', 'y'], 'mouse-click': ['x', 'y'],
  'mouse-scroll': ['x', 'y', 'delta'], 'key-press': ['keys'],
  'type-text': ['text'], 'get-cursor': [], 'shell': ['command'],
  'invoke-worker': ['worker', 'prompt'], 'promote-hf': [],
  'repo-list': ['path'], 'repo-read': ['path'], 'repo-write': ['path', 'content'], 'repo-edit': ['path', 'old'],
  'repo-test': ['command'], 'git-status': [], 'git-diff': [], 'git-commit': ['message'], 'git-push': [], 'git-merge': ['ref'],
  'repo-service': ['id', 'action'],
  // Creates a repository on the operator's GitHub account through the API (agents/lib/github-repo.mjs).
  'github-create-repo': ['name'],
  // Paid repo security scan for one order (agents/lib/repo-scan.mjs).
  'repo-scan': ['url', 'order'],
  // A read-only tool of any MCP server JACO hosts (agents/lib/mcp-tools.mjs).
  'mcp-call': ['server', 'tool'],
  // An MCP tool that changes something, on a server the operator opened to agents for writing.
  'mcp-write': ['server', 'tool'],
  // Loads one of JACO's skills (SKILL.md) so the planner can follow it (agents/lib/skills.mjs).
  'skill-load': ['id'],
  // Secrets for sign-ups and API keys (agents/lib/secret-capture.mjs); only NOVA_* keys, values never returned.
  'vault-generate-secret': ['key'], 'vault-get-secret': ['key'], 'vault-list-secrets': [], 'secret-store': ['handle', 'key'],
  // JACO's own inbox: verification mail to jaco-*@ addresses (agents/lib/inbox.mjs).
  'email-inbox': [],
};

// Shared contracts for native tools and constrained JSON planning.
export const TASK_SCHEMAS = {
  'repo-service': {id:{type:'string'},action:{type:'string',enum:['start','status','stop']}},
  'repo-list': {path:{type:'string'}}, 'repo-read': {path:{type:'string'}},
  'repo-write': {path:{type:'string'},content:{type:'string'}},
  'repo-edit': {path:{type:'string'},old:{type:'string'},new:{type:'string'},replaceAll:{type:'boolean'}},
  'repo-test': {command:{type:'string'},kind:{type:'string',enum:['test','falsifier','verify']}},
  'web-fetch': {url:{type:'string'},expect:{type:'object',properties:{status:{type:'integer',minimum:100,maximum:599},contains:{type:'string',maxLength:1000}},additionalProperties:false}},
  'browser-click': {name:{type:'string'},expect:{type:'object',properties:{url:{type:'string'},selector:{type:'string'}}}},
};

export function taskContract(type) {
  return {type:'object',properties:TASK_SCHEMAS[type]||Object.fromEntries((TASK_FIELDS[type]||[]).map(f=>[f,{}])),required:TASK_FIELDS[type]||[],additionalProperties:true};
}
