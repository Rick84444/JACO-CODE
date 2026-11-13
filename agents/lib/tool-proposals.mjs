// Tools Aura proposes for herself (docs/aura/OPERATING_CONTRACT.md, section 6). When a plan needs something she
// cannot do, or a tool keeps failing, she may propose an MCP server to add. A proposal is a record, never an
// installation: nothing runs until the operator approves it in the approval center, where it then takes the same
// path as a tool the operator added by hand (a Git source is staged and promoted; a command or HTTP server is saved
// with read access). Secrets are never part of a proposal; a command may only reference them as ${ENV_NAME}.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROPOSAL_SCHEMA = 'jaco.tool-proposal/v1';
export const PROPOSAL_KINDS = Object.freeze(['mcp-git', 'mcp-command', 'mcp-http']);
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,79}$/;
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Pure validation of what the planner sends. Throws a code the model can read and correct.
export function validateToolProposal(data = {}) {
  const kind = String(data.kind || '');
  if (!PROPOSAL_KINDS.includes(kind)) throw new Error(`TOOL_PROPOSAL_KIND_INVALID:${clip(kind, 40)}`);
  const name = String(data.name || '').toLowerCase();
  if (!ID.test(name)) throw new Error('TOOL_PROPOSAL_NAME_INVALID');
  const reason = clip(data.reason, 600);
  if (reason.length < 10) throw new Error('TOOL_PROPOSAL_REASON_REQUIRED');
  const out = { schema: PROPOSAL_SCHEMA, kind, name, reason, need: clip(data.need, 80) || null };
  if (kind === 'mcp-git') {
    const url = new URL(String(data.repoUrl || ''));
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('TOOL_PROPOSAL_REPO_HTTPS_REQUIRED');
    if (!/^(github\.com|gitlab\.com|codeberg\.org)$/.test(url.hostname)) throw new Error('TOOL_PROPOSAL_REPO_HOST_UNSUPPORTED');
    out.repoUrl = url.origin + url.pathname.replace(/\.git$/, '').replace(/\/+$/, '');
    out.ref = data.ref == null ? null : clip(data.ref, 120);
  } else if (kind === 'mcp-command') {
    const command = clip(data.command, 300);
    if (!/^(npx|node|python3?|uvx|deno)$/.test(command)) throw new Error('TOOL_PROPOSAL_COMMAND_UNSUPPORTED');
    const args = Array.isArray(data.args) ? data.args.map(a => clip(a, 200)) : [];
    if (!args.length || args.length > 20 || args.some(a => !a || /[;&|<>`$]/.test(a))) throw new Error('TOOL_PROPOSAL_ARGS_INVALID');
    const env = {};
    for (const [k, v] of Object.entries(data.env || {})) {
      if (!ENV_NAME.test(k)) throw new Error('TOOL_PROPOSAL_ENV_NAME_INVALID');
      if (!/^\$\{[A-Z][A-Z0-9_]{0,79}\}$/.test(String(v))) throw new Error('TOOL_PROPOSAL_ENV_MUST_BE_REFERENCE');
      env[k] = String(v);
    }
    Object.assign(out, { command, args, env });
  } else {
    const url = new URL(String(data.url || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('TOOL_PROPOSAL_URL_HTTPS_REQUIRED');
    out.url = url.toString();
    if (data.tokenEnv != null) { if (!ENV_NAME.test(String(data.tokenEnv))) throw new Error('TOOL_PROPOSAL_TOKEN_ENV_INVALID'); out.tokenEnv = String(data.tokenEnv); }
  }
  return out;
}

// What the approval center hands to the MCP host once the operator says yes.
export function serverEntryFor(proposal) {
  if (proposal.kind === 'mcp-command') return { name: proposal.name, role: proposal.reason, agentAccess: 'read', transport: 'stdio', command: proposal.command, args: proposal.args, env: proposal.env };
  if (proposal.kind === 'mcp-http') return { name: proposal.name, role: proposal.reason, agentAccess: 'read', transport: 'http', url: proposal.url, tokenEnv: proposal.tokenEnv || null };
  return null;
}

export function proposalStore(stateDir) {
  const file = join(stateDir, 'tool-proposals.json');
  const read = () => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = rows => { mkdirSync(stateDir, { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(rows, null, 2)); renameSync(`${file}.tmp`, file); };
  return {
    list: () => read(),
    // One proposal per (kind, name, source): the same wish from several missions merges, with every mission recorded.
    add(proposal, { missionId = null, now = Date.now() } = {}) {
      const valid = validateToolProposal(proposal);
      const key = `${valid.kind}|${valid.name}|${valid.repoUrl || valid.url || `${valid.command} ${valid.args.join(' ')}`}`;
      const id = `tool-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
      const rows = read();
      let row = rows.find(r => r.id === id);
      if (!row) { row = { ...valid, id, status: 'PENDING', createdAt: new Date(now).toISOString(), missions: [] }; rows.push(row); }
      if (missionId && !row.missions.includes(missionId)) row.missions = [...row.missions, String(missionId)].slice(-20);
      write(rows);
      return { ...row, replayed: rows.indexOf(row) >= 0 && row.createdAt !== new Date(now).toISOString() };
    },
    get: id => read().find(r => r.id === id) || null,
    decide(id, decision, { note = '', result = null, now = Date.now() } = {}) {
      const rows = read();
      const row = rows.find(r => r.id === id);
      if (!row) throw new Error('TOOL_PROPOSAL_NOT_FOUND');
      if (row.status !== 'PENDING') throw new Error(`TOOL_PROPOSAL_${row.status}`);
      if (!['approve', 'reject'].includes(decision)) throw new Error('INVALID_DECISION');
      Object.assign(row, { status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedAt: new Date(now).toISOString(), decisionNote: clip(note, 300), result });
      write(rows);
      return row;
    },
  };
}
