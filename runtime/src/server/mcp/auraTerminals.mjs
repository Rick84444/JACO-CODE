// Aura's terminals (operator 2026-11-27: "let her open several terminals"). A terminal is a name on the existing
// shell tool: each name keeps its own working folder and its recent commands, so the operator sees one window per
// task. Nothing here runs a program or grants anything: every command still goes through the same MCP shell call,
// with its rules, switches and mandate. What is shown lives in memory only and has token shapes removed.
// Token shapes removed from what is shown. Long paths and commit ids stay readable (the spoken-text redaction
// hid file names, 2026-11-27): only known key prefixes, bearer values, 64-digit hex keys and long mixed-case
// strings with digits are replaced.
export const redactTerminal = text => String(text ?? '')
  .replace(/Bearer\s+\S+/gi, 'Bearer [secret]')
  .replace(/\b(?:sk|pk|rk|hf|gsk|xai|gh[pousr]|github_pat|xox[abp]|jdev|jide)[-_][A-Za-z0-9_-]{12,}/g, '[secret]')
  .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '[secret]')
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[secret]')
  .replace(/\b[a-f0-9]{64}\b/gi, '[secret]')
  .replace(/(?<![\w/.-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{32,}={0,2}(?![\w/.-])/g, '[secret]')
  .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*\S+/g, '$1=[secret]');

export const TERMINAL_TOOLS = new Set(['shell_run', 'shell_read']);
const MAX_TERMINALS = 6, MAX_ENTRIES = 12, MAX_OUTPUT = 1600;
export const terminalName = value => String(value ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || 'main';

const outcome = result => {
  const text = String(result?.content?.find?.(item => item?.type === 'text')?.text || '');
  let data = null; try { data = JSON.parse(text); } catch { /* plain text */ }
  const output = data ? [data.stdout, data.stderr, data.reason].filter(Boolean).join('\n') : text;
  return { ok: result?.isError !== true && data?.ok !== false, output };
};

export function createAuraTerminals({ now = () => new Date().toISOString() } = {}) {
  const terminals = new Map();
  const get = name => {
    let t = terminals.get(name);
    if (!t) {
      // The longest unused window makes room.
      if (terminals.size >= MAX_TERMINALS) terminals.delete([...terminals.values()].sort((a, b) => a.used - b.used)[0].name);
      terminals.set(name, (t = { name, cwd: null, entries: [], used: 0 }));
    }
    return t;
  };
  let order = 0;
  const record = (t, command, ok, output) => {
    t.entries.push({ at: now(), command: redactTerminal(command).slice(0, 300), ok, output: redactTerminal(output).trim().slice(-MAX_OUTPUT) });
    if (t.entries.length > MAX_ENTRIES) t.entries.shift();
  };
  return {
    /** Runs one shell call in the named terminal. `call` receives the arguments without the terminal name. */
    async run(args, call) {
      const { terminal, ...rest } = args || {};
      const t = get(terminalName(terminal));
      t.used = ++order;
      if (rest.cwd === undefined && t.cwd) rest.cwd = t.cwd;
      const command = [rest.command, ...(Array.isArray(rest.args) ? rest.args : [])].filter(Boolean).join(' ');
      try {
        const result = await call(rest);
        const seen = outcome(result);
        if (seen.ok && rest.cwd) t.cwd = rest.cwd;
        record(t, command, seen.ok, seen.output);
        return result;
      } catch (error) {
        record(t, command, false, String(error?.message || error));
        throw error;
      }
    },
    list: () => [...terminals.values()].map(({ name, cwd, entries }) => ({ name, cwd, entries: [...entries] })),
  };
}

export const auraTerminals = createAuraTerminals();
