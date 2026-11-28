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

// The Operator Stage: Aura in the middle, panels beside her that she lights up while she talks about them.
export const STAGE_PANELS = Object.freeze(['mission', 'browser', 'tools']);
export const STAGE_CONTROL_INSTRUCTION = [
  'You are on the operator\'s stage: you stand in the middle and panels sit beside you.',
  'When you talk about one of them, light it up by writing a directive on its own line; the stage enlarges it with a glow and hides the directive:',
  `[[jaco:focus PANEL]] where PANEL is mission (the work running now, its plan and steps), browser (the page your browser shows) or tools (the tool calls you made).`,
  'Use it when the panel helps the operator see what you mean, at most two per reply. It only changes what is shown.',
  'You can keep several pages open (browser server: nova_tab_open, nova_tab_switch) and several terminals (shell server: give shell_run or shell_read a terminal name per task); the operator sees them beside you.',
].join(' ');

const DIRECTIVE = /\[\[jaco:(open|terminal|file|focus)(?:\s+([^\]\r\n]{1,300}))?\]\]/gi;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[\w .\-\\/@+]{1,300}$/;

/** @param {string} reply @returns {{ text: string, actions: Array<{type:'open',view:string}|{type:'terminal'}|{type:'file',path:string}|{type:'focus',panel:string}> }} */
export function extractWorkspaceActions(reply) {
  const actions = [];
  const text = String(reply || '').replace(DIRECTIVE, (_match, verb, arg) => {
    if (actions.length >= 3) return '';
    const kind = verb.toLowerCase();
    const value = String(arg || '').trim();
    if (kind === 'terminal') actions.push({ type: 'terminal' });
    else if (kind === 'open' && WORKSPACE_VIEWS.includes(value.toLowerCase())) actions.push({ type: 'open', view: value.toLowerCase() });
    else if (kind === 'file' && SAFE_PATH.test(value)) actions.push({ type: 'file', path: value.replace(/\\/g, '/') });
    else if (kind === 'focus' && STAGE_PANELS.includes(value.toLowerCase())) actions.push({ type: 'focus', panel: value.toLowerCase() });
    return '';
  })
    // A directive with a verb the GUI does not know ([[jaco:browser]]) is still a directive, never reply text.
    .replace(/\[\[jaco:[^\]\r\n]{0,300}\]\]/gi, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, actions };
}

/** The reply text everyone stores and shows: directives removed, never empty. @param {string} reply */
export function workspaceReplyText(reply) {
  const { text } = extractWorkspaceActions(reply);
  return text || 'Showing it in the workspace.';
}
