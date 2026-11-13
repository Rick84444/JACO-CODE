// Writing one file anywhere on the local computer, with the operator's yes each time (docs/aura/OPERATING_CONTRACT.md,
// section 6.3). Missions normally write only inside their own git worktree, where the operator reviews the result before
// it reaches the real folder. `local-write` is the explicit exception: it needs a decision for exactly this path and
// this content (operator-action-guard.mjs, a one-shot approval), and it still refuses places no mission should touch.
//
// What it will not touch, approval or not: system folders, program folders, startup folders (persistence), other
// users' profiles, credential and key files, git internals, and JACO's own state and secrets.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LOCAL_WRITE_MAX_BYTES = 250_000;
const norm = p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/');

const FORBIDDEN = [
  [/^[a-z]:\/windows(\/|$)/i, 'the Windows system folder'],
  [/^[a-z]:\/program files( \(x86\))?(\/|$)/i, 'a program folder'],
  [/^[a-z]:\/programdata(\/|$)/i, 'shared program data'],
  [/^[a-z]:\/\$recycle\.bin(\/|$)|^[a-z]:\/system volume information(\/|$)/i, 'a system volume folder'],
  [/(^|\/)startup(\/|$)|(^|\/)start menu\/programs\/startup(\/|$)/i, 'a startup folder (it would run at login)'],
  [/^\/(etc|bin|sbin|usr|boot|sys|proc|dev|lib|lib64|var\/run)(\/|$)/, 'a system folder'],
  [/(^|\/)\.(ssh|aws|gnupg|azure|kube|docker)(\/|$)/i, 'a credential folder'],
  [/(^|\/)\.git(\/|$)/i, 'git internals'],
  [/(^|\/)\.jaco(\/|$)|(^|\/)\.jaco-emergency-stop\.json$/i, "JACO's own state"],
  [/(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|[\w.-]*\.(pem|key|pfx|p12|kdbx))$/i, 'a credential or key file'],
  [/(^|\/)(site-logins|secrets)\.json$|(^|\/)secret\.key$/i, "JACO's stored logins and secrets"],
  [/(^|\/)ntuser\.dat[\w.]*$|(^|\/)appdata\/roaming\/microsoft\/(windows|credentials|protect)(\/|$)/i, 'Windows user data'],
];

// Pure: returns { path } with the resolved absolute path, or throws a code the planner can read and fix.
export function checkLocalWritePath(input, { platform = process.platform } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 400 || /[\0\r\n]/.test(raw)) throw new Error('LOCAL_WRITE_PATH_INVALID');
  // Mission validation is transport-independent. Recognize a fully qualified
  // Windows path even when CI validates the contract on Linux. Execution below
  // still rejects paths that are not native to the *actual* host.
  const windowsDrive = /^[a-z]:[\\\\/]/i.test(raw);
  if (/^(?:\\\\\\\\|\/\/|\\\\\\\\[?.]\\\\)/.test(raw)) throw new Error('LOCAL_WRITE_PATH_UNC_NOT_SUPPORTED');
  const lib = (platform === 'win32' || windowsDrive) ? path.win32 : path.posix;
  if (lib === path.win32 && !windowsDrive) throw new Error('LOCAL_WRITE_PATH_NOT_ABSOLUTE');
  if (!lib.isAbsolute(raw)) throw new Error('LOCAL_WRITE_PATH_NOT_ABSOLUTE');
  if (raw.replace(/\\/g, '/').split('/').includes('..')) throw new Error('LOCAL_WRITE_PATH_PARENT_SEGMENT');
  if (/[*?<>|"]/.test(raw.replace(/^[a-zA-Z]:/, ''))) throw new Error('LOCAL_WRITE_PATH_GLOB_NOT_SUPPORTED');
  const resolved = lib.normalize(raw);
  // A bare drive root or filesystem root is not a file.
  if (/^[a-zA-Z]:[\\/]?$/.test(resolved) || resolved === '/') throw new Error('LOCAL_WRITE_PATH_IS_ROOT');
  const hit = FORBIDDEN.find(([re]) => re.test(norm(resolved)));
  if (hit) throw new Error(`LOCAL_WRITE_PATH_FORBIDDEN:${hit[1]}`);
  return { path: resolved };
}

export function checkLocalWriteTask(data = {}, options) {
  const { path: target } = checkLocalWritePath(data.path, options);
  if (typeof data.content !== 'string') throw new Error('LOCAL_WRITE_CONTENT_INVALID');
  if (Buffer.byteLength(data.content, 'utf8') > LOCAL_WRITE_MAX_BYTES) throw new Error('LOCAL_WRITE_CONTENT_TOO_LARGE');
  return { path: target, content: data.content };
}

// Performs the write after approval and proves it: the file is read back and its hash compared with the intended
// content. A target that is a directory, a link, or changed under us is a failure, never a silent success.
export function performLocalWrite(data, { fsImpl = fs } = {}) {
  let target, content;
  try { ({ path: target, content } = checkLocalWriteTask(data)); }
  catch (error) { return { ok: false, verified: false, error: error.message }; }
  try {
    // Never reinterpret C:\\... as a relative POSIX filename, or POSIX paths as
    // drive-relative paths on Windows, even if a remote mission described them.
    if (!path.isAbsolute(target)) return { ok: false, verified: false, error: 'LOCAL_WRITE_PATH_PLATFORM_MISMATCH' };
    const parent = path.dirname(target);
    fsImpl.mkdirSync(parent, { recursive: true });
    let existed = false, previousSha = null;
    try {
      const stat = fsImpl.lstatSync(target);
      if (stat.isSymbolicLink()) return { ok: false, verified: false, error: 'LOCAL_WRITE_TARGET_IS_LINK' };
      if (!stat.isFile()) return { ok: false, verified: false, error: 'LOCAL_WRITE_TARGET_NOT_A_FILE' };
      existed = true;
      previousSha = createHash('sha256').update(fsImpl.readFileSync(target)).digest('hex');
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    fsImpl.writeFileSync(target, content, 'utf8');
    const written = createHash('sha256').update(fsImpl.readFileSync(target)).digest('hex');
    const intended = createHash('sha256').update(content, 'utf8').digest('hex');
    const verified = written === intended;
    return { ok: verified, verified, path: target, bytes: Buffer.byteLength(content, 'utf8'), sha256: written, overwrote: existed, previousSha256: previousSha,
      ...(verified ? {} : { error: 'LOCAL_WRITE_READBACK_MISMATCH' }) };
  } catch (error) {
    return { ok: false, verified: false, error: `LOCAL_WRITE_FAILED:${String(error?.code || error?.message || error).slice(0, 120)}` };
  }
}
