// Pure checks for the explicit, operator-run photoreal-head installer (runtime/scripts/install-aura-splat.mjs).
// The head is a likeness of a real person: it is installed outside public/ and served only to the local operator
// (runtime/src/server/auraLocalAssets.mjs). Nothing here can verify that a rights notice is legally valid.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';

export const AURA_SPLAT_CONFIRM_FLAG = '--confirm-likeness-rights';
export const AURA_SPLAT_USAGE = 'Usage: node runtime/scripts/install-aura-splat.mjs --head /path/to/authorized-head.zip --license /path/to/rights-notice.txt ' + AURA_SPLAT_CONFIRM_FLAG;
const MIN_NOTICE_CHARS = 40, MIN_NOTICE_WORDS = 8, MAX_NOTICE_BYTES = 1024 * 1024;
export const MAX_HEAD_BYTES = 256 * 1024 * 1024;

// Never under public/: express.static would hand the face to anything that can reach the server.
export const auraSplatDir = runtimeRoot => join(runtimeRoot, 'local', 'aura-splat');

// Exactly: --head X --license Y --confirm-likeness-rights, in any order, nothing else.
export function parseInstallArgs(argv) {
  const out = {}; let confirmed = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === AURA_SPLAT_CONFIRM_FLAG) { if (confirmed) throw new Error('AURA_SPLAT_ARGS'); confirmed = true; }
    else if ((a === '--head' || a === '--license') && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--')) {
      const key = a === '--head' ? 'head' : 'notice';
      if (out[key]) throw new Error('AURA_SPLAT_ARGS');
      out[key] = argv[++i];
    } else throw new Error('AURA_SPLAT_ARGS');
  }
  if (!out.head || !out.notice) throw new Error('AURA_SPLAT_ARGS');
  if (!confirmed) throw new Error('AURA_SPLAT_RIGHTS_CONFIRMATION_REQUIRED');
  return out;
}

export function validateHeadZipHeader(magic, size) {
  if (!Number.isInteger(size) || size < 4 || size > MAX_HEAD_BYTES) throw new Error('AURA_SPLAT_HEAD_SIZE');
  if (!Buffer.from(magic).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('AURA_SPLAT_HEAD_NOT_ZIP');
}

// A rights notice must be readable text that says something, not an empty or placeholder file.
export function validateRightsNotice(bytes) {
  if (!bytes?.length || bytes.length > MAX_NOTICE_BYTES) throw new Error('AURA_SPLAT_RIGHTS_NOTICE_SIZE');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw new Error('AURA_SPLAT_RIGHTS_NOTICE_NOT_TEXT'); }
  if (text.includes('\0')) throw new Error('AURA_SPLAT_RIGHTS_NOTICE_NOT_TEXT');
  const trimmed = text.trim();
  if (trimmed.length < MIN_NOTICE_CHARS || trimmed.split(/\s+/).length < MIN_NOTICE_WORDS) throw new Error('AURA_SPLAT_RIGHTS_NOTICE_TOO_SHORT');
  return trimmed;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', c => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

export function provenanceText({rev, headSha256, noticeSha256, at}) {
  return 'Avatarz source: ' + rev + '\n'
    + 'Operator-supplied head sha256: ' + headSha256 + '\n'
    + 'Operator-supplied rights notice sha256: ' + noticeSha256 + '\n'
    + 'Installed: ' + at + '\n'
    + 'The operator confirmed at install time that they hold the rights to use this likeness. This is a statement, not verified legal clearance.\n'
    + 'Redistribution rights and dependency notices must be independently reviewed. Served only to the local operator UI.\n';
}
