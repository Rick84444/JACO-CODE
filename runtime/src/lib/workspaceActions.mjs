// Aura can steer what the operator's workspace shows while she talks. She writes a directive on its own line,
// the GUI performs it and removes it from the visible and spoken reply. Directives only change what is shown;
// they never run commands, write files or bypass any authority gate.

export const WORKSPACE_VIEWS = Object.freeze(['conversation', 'stage', 'code', 'preview', 'evidence', 'gameboard', 'connections', 'economy', 'agents']);

export const WORKSPACE_CONTROL_INSTRUCTION = [
  'You can show parts of the operator\'s JACO workspace while you talk with them.',
  'Write a directive on its own line; the GUI performs it and hides it from the reply:',
  `[[jaco:open VIEW]] where VIEW is one of ${WORKSPACE_VIEWS.join(', ')};`,
  '[[jaco:terminal]] opens the terminal; [[jaco:file RELATIVE/PATH]] opens a project file in the editor.',
  'Use them only when showing something helps the operator, at most three per reply.',
  'They only change what is shown; they never run commands or change files.',
].join(' ');

const DIRECTIVE = /\[\[jaco:(open|terminal|file)(?:\s+([^\]\r\n]{1,300}))?\]\]/gi;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[\w .\-\\/@+]{1,300}$/;

/** @param {string} reply @returns {{ text: string, actions: Array<{type:'open',view:string}|{type:'terminal'}|{type:'file',path:string}> }} */
export function extractWorkspaceActions(reply) {
  const actions = [];
  const text = String(reply || '').replace(DIRECTIVE, (_match, verb, arg) => {
    if (actions.length >= 3) return '';
    const kind = verb.toLowerCase();
    const value = String(arg || '').trim();
    if (kind === 'terminal') actions.push({ type: 'terminal' });
    else if (kind === 'open' && WORKSPACE_VIEWS.includes(value.toLowerCase())) actions.push({ type: 'open', view: value.toLowerCase() });
    else if (kind === 'file' && SAFE_PATH.test(value)) actions.push({ type: 'file', path: value.replace(/\\/g, '/') });
    return '';
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, actions };
}

/** The reply text everyone stores and shows: directives removed, never empty. @param {string} reply */
export function workspaceReplyText(reply) {
  const { text } = extractWorkspaceActions(reply);
  return text || 'Showing it in the workspace.';
}
