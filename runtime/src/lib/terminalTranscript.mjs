import { terminalText } from './terminalText.mjs';

const MAX_RECEIPTS = 40;
const MAX_STREAM = 8000;
const clip = value => {
  const text = terminalText(value);
  return text.length <= MAX_STREAM ? text : text.slice(0, MAX_STREAM) + '\n[output truncated]';
};

// Presentation only: normalized terminal receipts are never interpreted as commands.
export function terminalTranscript(events) {
  const receipts = events.filter(event => event?.terminal).slice(-MAX_RECEIPTS);
  if (!receipts.length) return 'No observed command receipts.';
  return receipts.map(({at, id, terminal: t}) => {
    const lines = ['[' + clip(at).slice(0,32) + '] ' + clip(id).slice(0,128), '$ ' + clip(t.command), 'Phase: ' + clip(t.phase).slice(0,64)];
    if (t.stdout) lines.push(clip(t.stdout));
    if (t.stderr) lines.push('stderr:', clip(t.stderr));
    if (Number.isInteger(t.exitCode)) lines.push('Exit code: ' + t.exitCode);
    if (t.truncated) lines.push('[receipt truncated by runtime]');
    return lines.join('\n');
  }).join('\n\n');
}
