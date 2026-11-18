// Render untrusted logs as text, never as terminal instructions.
export function terminalText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '\ufffd') : '';
}
