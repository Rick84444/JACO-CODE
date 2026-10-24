// JACO skills in the SKILL.md format (operator 2026-10-03: JACO owns its procedures; any LLM follows them).
// A skill is <root>/<id>/SKILL.md: frontmatter (name, description, tasks) and a markdown body of
// instructions. Running a skill creates a Nova mission whose goal names the skill; the planner then
// receives the body as state.skill, whichever model plans. tasks are the mission's allowedTasks.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP, isIPv4, BlockList } from 'node:net';
import { TASK_FIELDS } from './task-fields.mjs';
import { CODE_TASKS, normalizeCodingContract } from './coding-contract.mjs';

const ID = /^[a-z][a-z0-9-]{1,60}$/;
const MAX_BODY = 12_000;
// The mission goal of a skill run: "Skill <id>: <operator input>".
const GOAL = /^Skill ([a-z][a-z0-9-]{1,60}):/;

const unquote = v => v.replace(/^(['"])(.*)\1$/, '$2');
export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text || ''));
  if (!m) throw new Error('SKILL_FRONTMATTER_MISSING');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim();
    meta[kv[1]] = /^\[.*\]$/.test(value)
      ? value.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean)
      : unquote(value);
  }
  return { meta, body: m[2].trim() };
}

export function skillTasks(meta, { allowCode = false } = {}) {
  const tasks = Array.isArray(meta.tasks) ? meta.tasks : String(meta.tasks || '').split(',').map(s => s.trim()).filter(Boolean);
  const unknown = tasks.filter(t => !Object.hasOwn(TASK_FIELDS, t));
  if (unknown.length) throw new Error(`SKILL_TASK_UNKNOWN:${unknown.join(',')}`);
  // Code tasks need a coding contract; a skill run does not carry one yet.
  const code = tasks.filter(t => CODE_TASKS.has(t));
  if (code.length && !allowCode) throw new Error(`SKILL_CODE_TASKS_NEED_CONTRACT:${code.join(',')}`);
  if (!tasks.length) throw new Error('SKILL_TASKS_REQUIRED');
  return [...new Set(tasks)];
}

function readSkill(root, id) {
  const file = join(root, id, 'SKILL.md');
  if (!existsSync(file)) return null;
  if (statSync(file).size > MAX_BODY * 2) throw new Error('SKILL_TOO_LARGE');
  const { meta, body } = parseSkill(readFileSync(file, 'utf8'));
  return {
    id, name: String(meta.name || id), description: String(meta.description || '').slice(0, 500),
    tasks: skillTasks(meta, { allowCode: true }), body: body.slice(0, MAX_BODY), truncated: body.length > MAX_BODY, source: file,
  };
}

// Skills of all roots; the first root that has an id wins. A malformed skill is listed with its error,
// never silently dropped.
export function listSkills(roots) {
  const seen = new Map();
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const id of readdirSync(root).sort()) {
      if (!ID.test(id) || seen.has(id)) continue;
      try {
        const skill = readSkill(root, id);
        if (skill) { const { body, ...rest } = skill; seen.set(id, rest); }
      } catch (error) {
        seen.set(id, { id, name: id, description: '', tasks: [], error: String(error?.message || error), source: join(root, id, 'SKILL.md') });
      }
    }
  }
  return [...seen.values()];
}

export function loadSkill(roots, id) {
  if (!ID.test(String(id || ''))) throw new Error('SKILL_ID_INVALID');
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    const skill = readSkill(root, id);
    if (skill) return skill;
  }
  throw new Error('SKILL_NOT_FOUND');
}

export function skillMissionGoal(skill, input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('SKILL_INPUT_REQUIRED');
  if (text.length > 4000) throw new Error('SKILL_INPUT_TOO_LONG');
  return `Skill ${skill.id}: ${text}`;
}
export const skillIdOfGoal = goal => GOAL.exec(String(goal || ''))?.[1] || null;

// Nova's side: the skill body from the runtime, bounded, for the planner state.
const auth = env => { const t = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || ''; return { Authorization: `Bearer ${t}`, 'x-gateway-token': t }; };
// The skill catalog for the planner: id and description of every usable skill (cached 5 minutes).
let listCache = { at: 0, value: null };
export async function fetchSkillList({ env = process.env, fetchImpl = fetch, runtimeUrl, now = Date.now() } = {}) {
  if (listCache.value && now - listCache.at < 5 * 60_000) return listCache.value;
  const base = runtimeUrl || env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
  const res = await fetchImpl(`${base}/api/skills`, { headers: auth(env), signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.skills)) throw new Error(String(body.error || `HTTP_${res.status}`));
  const value = body.skills.filter(s => !s.error).map(s => ({ id: s.id, description: String(s.description || '').slice(0, 200), tasks: s.tasks }));
  listCache = { at: now, value };
  return value;
}
export function resetSkillList() { listCache = { at: 0, value: null }; }

export async function fetchSkill(id, { env = process.env, fetchImpl = fetch, runtimeUrl } = {}) {
  const base = runtimeUrl || env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
  const res = await fetchImpl(`${base}/api/skills/${encodeURIComponent(id)}`, { headers: auth(env), signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.skill) throw new Error(String(body.error || `HTTP_${res.status}`));
  const { name, description, body: instructions } = body.skill;
  return { id, name, description, instructions };
}

// Explicit operator installation; content remains a procedure, not executable setup code.
export function installSkill(root, id, content) {
  if (!ID.test(String(id || ''))) throw Error('SKILL_ID_INVALID');
  if (typeof content !== 'string' || content.length > MAX_BODY * 2) throw Error('SKILL_TOO_LARGE');
  const { meta, body } = parseSkill(content);
  skillTasks(meta, { allowCode: true });
  if (!body || body.length > MAX_BODY) throw Error('SKILL_BODY_INVALID');
  mkdirSync(root, { recursive: true });
  const dir = join(root, id);
  if (existsSync(dir)) throw Error('SKILL_ALREADY_EXISTS');
  const stage=join(root, `.${id}-${process.pid}-${Date.now()}`);
  mkdirSync(stage);
  try { writeFileSync(join(stage,'SKILL.md'),content,{flag:'wx',mode:0o600}); renameSync(stage,dir); }
  catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
  return readSkill(root,id);
}

// A SKILL.md fetched from an address instead of pasted: HTTPS only, no credentials in the URL, no
// local or private hosts, bounded size, and the same validation as a pasted skill. Nothing runs while
// installing; the operator's install action is the approval. GitHub file pages map to their raw file.
//
// Private hosts are refused at three points: the address as written (skillSourceUrl), every redirect
// target before it is requested (fetchSkillFromUrl follows redirects itself), and every address the
// name resolves to at connect time (publicOnlyLookup), so DNS answers cannot point the request inward.
const NON_PUBLIC = new BlockList();
for (const [subnet, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) NON_PUBLIC.addSubnet(subnet, prefix, 'ipv4');
for (const [subnet, prefix] of [['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8]]) NON_PUBLIC.addSubnet(subnet, prefix, 'ipv6');
const NON_PUBLIC_NAME = /(^|\.)(localhost|local|internal|intranet|lan|corp|home\.arpa)$/i;

function ipv6Groups(ip) {
  let text = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, -dotted[0].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split('::');
  const front = head ? head.split(':') : [];
  const back = tail === undefined ? null : tail ? tail.split(':') : [];
  const groups = back === null ? front : [...front, ...Array(8 - front.length - back.length).fill('0'), ...back];
  return groups.map(group => parseInt(group, 16));
}
// IPv4 carried inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16).
function embeddedIPv4(g) {
  const zero = (from, to) => g.slice(from, to).every(v => v === 0);
  const quad = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return quad(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return quad(g[6], g[7]);
  if (g[0] === 0x2002) return quad(g[1], g[2]);
  return null;
}
export function isNonPublicAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '');
  if (isIPv4(ip)) return NON_PUBLIC.check(ip, 'ipv4');
  if (isIP(ip) !== 6) return true; // not an address at all: fail closed
  const v4 = embeddedIPv4(ipv6Groups(ip));
  return (v4 !== null && NON_PUBLIC.check(v4, 'ipv4')) || NON_PUBLIC.check(ip, 'ipv6');
}

export function skillSourceUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw new Error('SKILL_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('SKILL_URL_HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('SKILL_URL_CREDENTIALS_NOT_ALLOWED');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const nonPublic = !host || (isIP(host) ? isNonPublicAddress(host) : NON_PUBLIC_NAME.test(host) || !host.includes('.'));
  if (nonPublic) throw new Error('SKILL_URL_PRIVATE_HOST');
  const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  if (url.hostname === 'github.com' && blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  return url.href;
}
// The id a fetched skill gets unless the operator names it: its name, else the folder or file it came from.
export function skillIdFrom(meta, url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const file = parts.at(-1) || '';
  const base = /^skill\.md$/i.test(file) ? parts.at(-2) : file.replace(/\.md$/i, '');
  for (const candidate of [meta?.name, base]) {
    const id = String(candidate || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 61).replace(/-+$/, '');
    if (ID.test(id)) return id;
  }
  throw new Error('SKILL_ID_REQUIRED');
}
// A DNS lookup that refuses the connection when any resolved address is not public. It runs at connect
// time inside the HTTPS request, so the checked address is the address that is connected to.
export function publicOnlyLookup(lookupImpl = dnsLookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = typeof options === 'number' ? { family: options } : { ...(options || {}) };
    lookupImpl(hostname, { ...opts, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(String(addresses)) }])
        .filter(entry => entry?.address);
      if (!list.length) return callback(Object.assign(new Error('SKILL_URL_DNS_EMPTY'), { code: 'ENOTFOUND' }));
      if (list.some(entry => isNonPublicAddress(entry.address)))
        return callback(Object.assign(new Error('SKILL_URL_PRIVATE_HOST'), { code: 'SKILL_URL_PRIVATE_HOST' }));
      if (opts.all) callback(null, list); else callback(null, list[0].address, list[0].family);
    });
  };
}
// One HTTPS GET through publicOnlyLookup. Never follows redirects; the caller decides per hop.
export function publicHttpsGet(url, { headers = {}, signal, lookupImpl, ca } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('SKILL_URL_HTTPS_REQUIRED'));
    const req = httpsRequest(target, { method: 'GET', headers, signal, lookup: publicOnlyLookup(lookupImpl), ...(ca ? { ca } : {}) }, res => {
      resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, url: target.href, body: res,
        headers: { get: name => { const v = res.headers[String(name).toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null; } },
      });
    });
    req.on('error', error => reject(error?.code === 'SKILL_URL_PRIVATE_HOST' ? new Error('SKILL_URL_PRIVATE_HOST') : error));
    req.end();
  });
}
// Reads at most `limit` bytes, whether or not the server sent a content-length, and stops the transfer beyond it.
async function readCapped(res, limit) {
  const chunks = [];
  let size = 0;
  const take = chunk => { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) return false; chunks.push(bytes); return true; };
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!take(value)) { await reader.cancel().catch(() => {}); throw new Error('SKILL_TOO_LARGE'); }
    }
  } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) if (!take(chunk)) { body.destroy?.(); throw new Error('SKILL_TOO_LARGE'); }
  } else {
    const text = await res.text();
    if (!take(text)) throw new Error('SKILL_TOO_LARGE');
  }
  return Buffer.concat(chunks).toString('utf8');
}
const discardBody = res => {
  try { res.body?.cancel?.().catch?.(() => {}); } catch {}
  try { res.body?.destroy?.(); } catch {}
};
const MAX_REDIRECTS = 3;
const MAX_FETCH_BYTES = MAX_BODY * 8;
export async function fetchSkillFromUrl(input, { fetchImpl = publicHttpsGet } = {}) {
  let url = skillSourceUrl(input);
  const signal = AbortSignal.timeout(15000);
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetchImpl(url, { redirect: 'manual', headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' }, signal });
    if (res.type === 'opaqueredirect') { discardBody(res); throw new Error('SKILL_URL_REDIRECT_INVALID'); }
    if (res.status < 300 || res.status >= 400) break;
    discardBody(res);
    if (hop >= MAX_REDIRECTS) throw new Error('SKILL_URL_TOO_MANY_REDIRECTS');
    const location = res.headers?.get?.('location');
    let next;
    try { next = new URL(location, url).href; } catch { throw new Error('SKILL_URL_REDIRECT_INVALID'); }
    if (!location) throw new Error('SKILL_URL_REDIRECT_INVALID');
    url = skillSourceUrl(next); // checked before the next request is made, not after
  }
  if (!res.ok) { discardBody(res); throw new Error(`SKILL_URL_HTTP_${res.status}`); }
  const finalUrl = res.url || url;
  skillSourceUrl(finalUrl); // a fetchImpl that followed a redirect anyway must still end on a public HTTPS host
  if (Number(res.headers?.get?.('content-length')) > MAX_FETCH_BYTES) { discardBody(res); throw new Error('SKILL_TOO_LARGE'); }
  const content = await readCapped(res, MAX_FETCH_BYTES);
  if (content.length > MAX_BODY * 2) throw new Error('SKILL_TOO_LARGE');
  if (/^\s*</.test(content)) throw new Error('SKILL_URL_NOT_MARKDOWN');
  const { meta, body } = parseSkill(content);
  skillTasks(meta, { allowCode: true });
  if (!body || body.length > MAX_BODY) throw new Error('SKILL_BODY_INVALID');
  return { url: finalUrl, content, suggestedId: skillIdFrom(meta, finalUrl), name: meta.name || '', description: meta.description || '' };
}

export function skillMissionSpec(skill, { input = '', executor = 'nova', projectRoot = '', testCommands = [] } = {}) {
  const goal=skillMissionGoal(skill,input),allowedTasks=skillTasks({tasks:skill.tasks},{allowCode:true});
  if(!allowedTasks.some(task=>CODE_TASKS.has(task)))return {goal,allowedTasks,executor};
  if(executor!=='nova')throw Error('SKILL_CODE_RUN_LOCAL_ONLY');
  if(!isAbsolute(String(projectRoot||'')))throw Error('SKILL_PROJECT_REQUIRED');
  if(!Array.isArray(testCommands)||testCommands.some(command=>typeof command!=='string'||!command.trim()))throw Error('SKILL_TEST_COMMANDS_INVALID');
  if(allowedTasks.includes('repo-test')&&!testCommands.length)throw Error('SKILL_TEST_COMMANDS_REQUIRED');
  const contract=normalizeCodingContract({
    objective:goal,scope:{allowed:['**']},acceptance:['Skill objective has observed receipts'],
    execution:{autonomous:true,allow_git_commit:allowedTasks.includes('git-commit'),allow_git_push:false,allow_git_merge:false},
    verification:{tests_required:allowedTasks.includes('repo-test'),falsifier_required:false,commands:testCommands},
  });
  return {goal,allowedTasks,executor,projectRoot,contract};
}
