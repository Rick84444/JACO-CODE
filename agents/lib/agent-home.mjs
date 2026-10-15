// An agent's home: the notes and memory it starts every run with (idea from OpenClaw's agent workspace).
// It lives outside any project, next to the key store but apart from it, so it can be backed up or synced
// (Jaco Drive) without carrying keys:
//   <state>/home/<agent>/AGENTS.md   how to work here: conventions, what to check, what to avoid
//                        SOUL.md     tone and boundaries
//                        USER.md     who the operator is, what they care about
//                        MEMORY.md   curated long-term facts and decisions (the main private run only)
//                        memory/YYYY-MM-DD.md   a log per day; today's and yesterday's are loaded
// Everything loaded is size-capped and has secrets replaced by handles; nothing here grants authority:
// a note cannot widen a mission's allowed tasks, budget or approvals.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './secret-store.mjs';
import { redactText } from './secret-capture.mjs';

export const HOME_LIMITS = { perFile: 20_000, total: 60_000, entry: 2_000, dailyFile: 200_000 };
const AGENT_ID = /^[a-z][a-z0-9-]{0,40}$/;
const FILES = ['AGENTS.md', 'SOUL.md', 'USER.md'];
const TEMPLATES = {
  'AGENTS.md': '# How to work here\n\n- Conventions, commands to run before finishing, things to avoid. One line each.\n',
  'SOUL.md': '# Tone and boundaries\n\n- How to talk to the operator, and what never to do without asking.\n',
  'USER.md': '# The operator\n\n- Who they are and what they care about.\n',
  'MEMORY.md': '# Long-term memory\n\n- Facts and decisions worth keeping. Write them as short lines.\n',
};

export function agentHomeDir(agentId = 'nova', env = process.env) {
  if (!AGENT_ID.test(String(agentId))) throw new Error('AGENT_ID_INVALID');
  return env.JACO_AGENT_HOME ? path.resolve(env.JACO_AGENT_HOME) : path.join(stateDir(env), 'home', agentId);
}

const day = (date) => date.toISOString().slice(0, 10);
const dailyName = date => path.join('memory', `${day(date)}.md`);

// A regular file inside the home, or null: a symlink could point at a key file.
function safeFile(dir, rel) {
  const full = path.join(dir, rel);
  try {
    const st = fs.lstatSync(full);
    return st.isFile() && !st.isSymbolicLink() ? full : null;
  } catch { return null; }
}

export function ensureHome(dir) {
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true, mode: 0o700 });
  const created = [];
  for (const [name, text] of Object.entries(TEMPLATES)) {
    try { fs.writeFileSync(path.join(dir, name), text, { mode: 0o600, flag: 'wx' }); created.push(name); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  return { dir, created };
}

/**
 * What the agent reads at the start of a run. `isPrivate` is true for the operator's own main session;
 * MEMORY.md is left out of anything shared.
 */
export function loadHome(dir, { isPrivate = true, now = new Date(), limits = HOME_LIMITS } = {}) {
  const want = [...FILES, ...(isPrivate ? ['MEMORY.md'] : []), dailyName(new Date(now.getTime() - 86_400_000)), dailyName(now)];
  const files = [], parts = [];
  let used = 0;
  for (const rel of want) {
    const full = safeFile(dir, rel);
    if (!full) continue;
    let text = fs.readFileSync(full, 'utf8').trim();
    if (!text) continue;
    let truncated = false;
    if (text.length > limits.perFile) { text = text.slice(text.length - limits.perFile); truncated = true; } // keep the newest part
    if (used + text.length > limits.total) { files.push({ name: rel, chars: 0, skipped: 'TOTAL_LIMIT' }); continue; }
    text = redactText(text).text;
    used += text.length;
    files.push({ name: rel, chars: text.length, truncated });
    parts.push(`## ${rel}\n${text}`);
  }
  return { text: parts.join('\n\n'), files, chars: used };
}

/** Appends one line to today's log. Returns the file written. */
export function appendMemory(dir, text, { now = new Date(), limits = HOME_LIMITS } = {}) {
  const line = redactText(String(text ?? '').replace(/\s+/g, ' ').trim()).text;
  if (!line) throw new Error('MEMORY_ENTRY_EMPTY');
  if (line.length > limits.entry) throw new Error('MEMORY_ENTRY_TOO_LONG');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true, mode: 0o700 });
  const rel = dailyName(now), full = path.join(dir, rel);
  try { const st = fs.lstatSync(full); if (st.isSymbolicLink() || !st.isFile()) throw new Error('MEMORY_FILE_NOT_REGULAR'); if (st.size > limits.dailyFile) throw new Error('MEMORY_DAY_FULL'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  fs.appendFileSync(full, `- ${now.toISOString().slice(11, 16)} ${line}\n`, { mode: 0o600 });
  return rel;
}
