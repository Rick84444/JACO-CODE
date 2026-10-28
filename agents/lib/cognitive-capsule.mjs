/**
 * JACO Cognitive Capsule v1 — opt-in, agent-scoped context and capability attenuation.
 * A capsule is data, NEVER a grant of authority. Every tool must also be permitted by
 * the active mission and the canonical runtime executor. No shell/code is executed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadHome, HOME_LIMITS } from './agent-home.mjs';
import { redactText } from './secret-capture.mjs';

const AGENT_ID = /^[a-z][a-z0-9-]{0,40}$/;
const NAME = /^[a-z][a-z0-9-]{0,79}$/;
const SCHEMA = 'jaco.cognitive-capsule/v1';
const MAX_CONFIG_BYTES = 16_384;
const MAX_PROMPT_BYTES = 32_768;
const MAX_SKILL_BYTES = 32_768;
const MAX_SKILLS = 64;

function validId(value, label, regex = NAME) {
  if (typeof value !== 'string' || !regex.test(value)) throw new Error(`${label}_INVALID`);
  return value;
}
function boundedList(value, label) {
  if (!Array.isArray(value) || value.length > 150) throw new Error(`${label}_INVALID`);
  for (const name of value) validId(name, label);
  if (new Set(value).size !== value.length) throw new Error(`${label}_DUPLICATE`);
  return value;
}
/** Reject symlinks anywhere between the capsule root and the requested file. */
function regularFile(root, relative, maxBytes) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..'))
    throw new Error('CAPSULE_UNSAFE_PATH');
  const parts = relative.split(/[\\/]/);
  let cursor = root;
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error('CAPSULE_SYMLINK_REJECTED');
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('CAPSULE_PARENT_NOT_DIRECTORY');
    if (i === parts.length - 1) {
      if (!stat.isFile()) throw new Error('CAPSULE_NOT_REGULAR_FILE');
      if (stat.size > maxBytes) throw new Error('CAPSULE_FILE_TOO_LARGE');
    }
  }
  return cursor;
}
function safeRead(root, relative, maxBytes) {
  const file = regularFile(root, relative, maxBytes);
  return file ? fs.readFileSync(file, 'utf8') : null;
}
function configOf(root, agentId) {
  const raw = safeRead(root, 'capsule.json', MAX_CONFIG_BYTES);
  if (raw === null) return null; // Existing agents remain unchanged unless opted in.
  let cfg;
  try { cfg = JSON.parse(raw); } catch { throw new Error('CAPSULE_INVALID_JSON'); }
  if (cfg?.schema !== SCHEMA || cfg.agentId !== agentId) throw new Error('CAPSULE_ID_OR_SCHEMA_MISMATCH');
  if (!cfg.tools || typeof cfg.tools !== 'object') throw new Error('CAPSULE_TOOLS_REQUIRED');
  const allow = boundedList(cfg.tools.allow, 'CAPSULE_ALLOW');
  const deny = boundedList(cfg.tools.deny ?? [], 'CAPSULE_DENY');
  if (allow.includes('*')) throw new Error('CAPSULE_WILDCARD_FORBIDDEN');
  return { raw, allow, deny, cfg };
}
function skillCatalog(root) {
  const base = path.join(root, 'skills');
  try {
    const st = fs.lstatSync(base);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('CAPSULE_SKILLS_UNSAFE');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = fs.readdirSync(base, { withFileTypes: true });
  if (entries.length > MAX_SKILLS) throw new Error('CAPSULE_TOO_MANY_SKILLS');
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      if (entry.isSymbolicLink()) throw new Error('CAPSULE_SKILL_SYMLINK_REJECTED');
      continue;
    }
    if (!NAME.test(entry.name)) throw new Error('CAPSULE_SKILL_NAME_INVALID');
    const raw = safeRead(root, `skills/${entry.name}/SKILL.md`, MAX_SKILL_BYTES);
    if (!raw) continue;
    const meta = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!meta) throw new Error('CAPSULE_SKILL_FRONTMATTER_REQUIRED');
    const name = /^name:\s*['"]?([^\r\n'"]+)['"]?\s*$/m.exec(meta[1])?.[1];
    const description = /^description:\s*['"]?([^\r\n'"]+)['"]?\s*$/m.exec(meta[1])?.[1];
    if (name !== entry.name || !description || description.length > 1024) throw new Error('CAPSULE_SKILL_METADATA_INVALID');
    skills.push({ name, description: redactText(description).text.slice(0, 1024) });
  }
  return skills;
}

/**
 * `mission.allowedTasks` comes from the runtime (authoritative). `capsule.tools.allow`
 * may only REDUCE it. Returned prompt and memory are lower-trust model context.
 */
export function loadCognitiveCapsule(root, { agentId, mission, isPrivate = true, withMemory = false } = {}) {
  validId(agentId, 'CAPSULE_AGENT_ID', AGENT_ID);
  if (!mission || !Array.isArray(mission.allowedTasks)) throw new Error('CAPSULE_MISSION_REQUIRED');
  const config = configOf(root, agentId);
  const missionTools = [...new Set(mission.allowedTasks)];
  if (!config) return { enabled: false, agentId, missionId: mission.id || null, allowedTasks: missionTools };
  const allowed = missionTools.filter(t => config.allow.includes(t) && !config.deny.includes(t));
  const promptFile = config.cfg.prompt ?? 'prompts/IDENTITY.md';
  if (promptFile !== 'prompts/IDENTITY.md') throw new Error('CAPSULE_PROMPT_PATH_INVALID');
  const rawPrompt = safeRead(root, promptFile, MAX_PROMPT_BYTES);
  if (rawPrompt === null) throw new Error('CAPSULE_PROMPT_MISSING');
  const identity = redactText(rawPrompt).text.trim();
  const fingerprint = createHash('sha256').update(config.raw).update('\u0000').update(rawPrompt).digest('hex');
  const out = {
    enabled: true, schema: SCHEMA, agentId, missionId: mission.id || null, fingerprint,
    allowedTasks: allowed, restrictedTasks: missionTools.filter(t => !allowed.includes(t)),
    identity, skills: skillCatalog(root),
  };
  if (withMemory) out.home = loadHome(root, { isPrivate, limits: { ...HOME_LIMITS, perFile: 6000, total: 15000 } });
  return out;
}

export function assertCognitiveCapsuleTask(root, { agentId, mission, task }) {
  const capsule = loadCognitiveCapsule(root, { agentId, mission });
  if (!capsule.allowedTasks.includes(task)) throw new Error(`CAPSULE_TASK_NOT_ALLOWED:${task}`);
  return capsule;
}

/** Explicit operator setup, never called automatically from an agent run. */
export function initCognitiveCapsule(root, agentId, { tools = ['repo-list', 'repo-read', 'git-status'] } = {}) {
  validId(agentId, 'CAPSULE_AGENT_ID', AGENT_ID);
  boundedList(tools, 'CAPSULE_ALLOW');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'prompts'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true, mode: 0o700 });
  const prompt = path.join(root, 'prompts', 'IDENTITY.md');
  const config = path.join(root, 'capsule.json');
  // Exclusive creates: do not silently overwrite operator or agent-owned files.
  try { fs.writeFileSync(prompt, '# Agent identity\n\nWork on the assigned mission; verify results and acknowledge uncertainty.\n', { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const payload = { schema: SCHEMA, agentId, prompt: 'prompts/IDENTITY.md', tools: { allow: tools, deny: [] } };
  fs.writeFileSync(config, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { root, config, prompt };
}
