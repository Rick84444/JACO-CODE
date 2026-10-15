// One interface for "a place where an agent works" (idea from OpenHands' workspaces): the agent code asks the
// workspace to list, read, write and run, and does not care whether that is this computer, or a paired phone
// reached through its JACO Shell MCP server. Access is per workspace (idea from OpenClaw's workspaceAccess):
//   none   nothing, not even listing
//   ro     list, read and read-only commands
//   rw     also write files and run commands that change things
import fs from 'node:fs';
import path from 'node:path';
import { SafeShell, inside, realPrefix, PROTECTED_READ, PROTECTED_WRITE } from './safe-shell.mjs';

export const ACCESS = ['none', 'ro', 'rw'];
const MAX_READ = 256 * 1024, MAX_WRITE = 1024 * 1024, MAX_LIST = 500;
const refused = reason => ({ ok: false, refused: true, reason });

export class LocalWorkspace {
  constructor({ root, access = 'ro', shell = null, env = process.env } = {}) {
    if (!root) throw new Error('WORKSPACE_ROOT_REQUIRED');
    if (!ACCESS.includes(access)) throw new Error('WORKSPACE_ACCESS_INVALID');
    this.kind = 'local'; this.root = path.resolve(root); this.access = access;
    this.shell = shell || new SafeShell({ workspace: this.root, env });
  }
  info() { return { kind: this.kind, root: this.root, access: this.access, shell: this.access === 'none' ? null : this.shell.info() }; }

  // The real path of rel inside the workspace, or a refusal.
  #resolve(rel, { write = false } = {}) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) return refused('PATH_INVALID');
    if (/^~/.test(rel)) return refused('HOME_PATH_NOT_ALLOWED');
    const root = realPrefix(this.root), target = realPrefix(path.resolve(this.root, rel));
    if (!inside(root, target)) return refused(`PATH_OUTSIDE_WORKSPACE:${rel}`);
    const within = path.relative(root, target);
    if (PROTECTED_READ.test(within) || (write && PROTECTED_WRITE.test(within))) return refused(`PROTECTED_PATH:${rel}`);
    return { ok: true, full: target, within };
  }

  list(rel = '.') {
    if (this.access === 'none') return refused('WORKSPACE_ACCESS_NONE');
    const at = rel === '.' ? { ok: true, full: realPrefix(this.root), within: '' } : this.#resolve(rel);
    if (!at.ok) return at;
    let entries;
    try { entries = fs.readdirSync(at.full, { withFileTypes: true }); } catch (error) { return { ok: false, error: error?.code || 'LIST_FAILED' }; }
    const shown = entries.filter(e => !PROTECTED_READ.test(e.name)).slice(0, MAX_LIST).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' }));
    return { ok: true, path: at.within || '.', entries: shown, truncated: entries.length > MAX_LIST };
  }

  read(rel, { maxBytes = MAX_READ } = {}) {
    if (this.access === 'none') return refused('WORKSPACE_ACCESS_NONE');
    const at = this.#resolve(rel);
    if (!at.ok) return at;
    try {
      const st = fs.statSync(at.full);
      if (!st.isFile()) return { ok: false, error: 'NOT_A_FILE' };
      const cap = Math.min(MAX_READ, Math.max(1, Number(maxBytes) || MAX_READ));
      const fd = fs.openSync(at.full, 'r');
      try { const buf = Buffer.alloc(Math.min(cap, st.size)); fs.readSync(fd, buf, 0, buf.length, 0); return { ok: true, path: at.within, content: buf.toString('utf8'), bytes: st.size, truncated: st.size > cap }; }
      finally { fs.closeSync(fd); }
    } catch (error) { return { ok: false, error: error?.code || 'READ_FAILED' }; }
  }

  write(rel, content) {
    if (this.access !== 'rw') return refused(this.access === 'none' ? 'WORKSPACE_ACCESS_NONE' : 'WORKSPACE_READ_ONLY');
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_WRITE) return refused('CONTENT_INVALID_OR_TOO_LARGE');
    const at = this.#resolve(rel, { write: true });
    if (!at.ok) return at;
    try {
      fs.mkdirSync(path.dirname(at.full), { recursive: true });
      // Re-check after creating the folder: a symlink made in between must not lead out.
      if (!inside(realPrefix(this.root), realPrefix(at.full))) return refused(`PATH_OUTSIDE_WORKSPACE:${rel}`);
      fs.writeFileSync(at.full, content);
      return { ok: true, path: at.within, bytes: Buffer.byteLength(content) };
    } catch (error) { return { ok: false, error: error?.code || 'WRITE_FAILED' }; }
  }

  run({ command, args = [], cwd = '.', timeoutSeconds } = {}) {
    if (this.access === 'none') return Promise.resolve(refused('WORKSPACE_ACCESS_NONE'));
    return this.shell.run({ command, args, cwd, timeoutSeconds, mode: this.access === 'rw' ? 'write' : 'read' });
  }
}

/**
 * The same interface for a workspace on a paired device, reached through that device's JACO Shell MCP server.
 * `callTool(name, args)` is the transport (the MCP host, or an HTTP relay); file reads and writes go through
 * the shell's own allowlisted programs, so the device applies its own limits as well.
 */
export class RemoteShellWorkspace {
  constructor({ callTool, access = 'ro', label = 'remote' } = {}) {
    if (typeof callTool !== 'function') throw new Error('CALL_TOOL_REQUIRED');
    if (!ACCESS.includes(access)) throw new Error('WORKSPACE_ACCESS_INVALID');
    this.kind = 'remote-shell'; this.callTool = callTool; this.access = access; this.label = label;
  }
  info() { return { kind: this.kind, label: this.label, access: this.access }; }
  async #shell(tool, command, args, extra = {}) {
    const out = await this.callTool(tool, { command, args, ...extra });
    const text = out?.content?.[0]?.text;
    try { return JSON.parse(text); } catch { return { ok: false, error: 'REMOTE_REPLY_INVALID' }; }
  }
  async list(rel = '.') { return this.access === 'none' ? refused('WORKSPACE_ACCESS_NONE') : this.#shell('shell_read', 'ls', ['-1', rel]); }
  async read(rel) { return this.access === 'none' ? refused('WORKSPACE_ACCESS_NONE') : this.#shell('shell_read', 'cat', [rel]); }
  async write() { return refused('REMOTE_WRITE_USES_RUN'); }
  async run({ command, args = [], cwd, timeoutSeconds } = {}) {
    if (this.access === 'none') return refused('WORKSPACE_ACCESS_NONE');
    return this.#shell(this.access === 'rw' ? 'shell_run' : 'shell_read', command, args, { ...(cwd ? { cwd } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}) });
  }
}
