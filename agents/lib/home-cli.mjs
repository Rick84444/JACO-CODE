// jaco home init | show | note "text"   (an agent's notes and memory; see agent-home.mjs)
import { agentHomeDir, ensureHome, loadHome, appendMemory } from './agent-home.mjs';

export function homeCli(argv, env = process.env, out = text => process.stdout.write(text)) {
  const [sub, ...rest] = argv;
  const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest.splice(i, 2)[1] : null; };
  const agent = flag('--agent') || 'nova';
  let dir;
  try { dir = agentHomeDir(agent, env); } catch { out('Unknown agent name (letters, digits, dashes).\n'); return 2; }
  if (sub === 'init') {
    const r = ensureHome(dir);
    out(`${dir}\n${r.created.length ? `created: ${r.created.join(', ')}` : 'already set up'}\n`);
    return 0;
  }
  if (sub === 'show') {
    const h = loadHome(dir, { isPrivate: true });
    out(h.text ? `${h.text}\n\n(${h.files.map(f => `${f.name}${f.truncated ? ' (cut)' : ''}`).join(', ')}; ${h.chars} characters)\n` : `Nothing in ${dir} yet. Run: jaco home init\n`);
    return 0;
  }
  if (sub === 'note') {
    const text = rest.join(' ').trim();
    if (!text) { out('Usage: jaco home note "what to remember"\n'); return 2; }
    try { out(`saved in ${appendMemory(dir, text)}\n`); return 0; } catch (error) { out(`${String(error.message)}\n`); return 1; }
  }
  out('Usage: jaco home init|show|note "text" [--agent name]\n');
  return sub ? 2 : 0;
}
