// Repository-wide leak prevention. This detects known token formats in every
// Git-publishable text file; it is not a certification of old Git history.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

const PATTERNS = Object.freeze([
  ['openai', /\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['github', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['github-fine-grained', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['slack', /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe-live', /\b[rs]k_live_[A-Za-z0-9]{20,}\b/],
  ['stripe-webhook', /\bwhsec_[A-Za-z0-9]{24,}\b/],
  ['hugging-face', /\bhf_[A-Za-z0-9]{20,}\b/],
  ['cloudflare-token', /\bcf[au]t_[A-Za-z0-9_-]{30,}\b/],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]{100,}?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
const readGit = (args, cwd) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const safeError = error => error?.code || error?.name || 'IO_ERROR';

export function scanRepositorySecrets({ root = process.cwd() } = {}) {
  const findings = [];
  const errors = [];
  let filesChecked = 0;
  let binaryFiles = 0;
  let listed = 0;
  let gitRoot;
  let paths;
  try {
    gitRoot = path.resolve(readGit(['rev-parse', '--show-toplevel'], root).trim());
    // Scan all indexed and publishable untracked paths, not only the runtime subfolder.
    paths = [...new Set(readGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], gitRoot).split('\0').filter(Boolean))].sort();
  } catch (error) {
    return { ok: false, listed, filesChecked, binaryFiles, findings, errors: [{ path: '(git)', code: safeError(error) }] };
  }
  listed = paths.length;
  for (const relative of paths) {
    const absolute = path.resolve(gitRoot, relative);
    if (absolute !== gitRoot && !absolute.startsWith(gitRoot + path.sep)) {
      errors.push({ path: relative, code: 'PATH_OUTSIDE_REPO' });
      continue;
    }
    let bytes;
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) bytes = Buffer.from(fs.readlinkSync(absolute), 'utf8');
      else if (stat.isFile()) bytes = fs.readFileSync(absolute);
      else { errors.push({ path: relative, code: 'NOT_A_FILE' }); continue; }
    } catch (error) {
      errors.push({ path: relative, code: safeError(error) });
      continue;
    }
    if (bytes.includes(0)) { binaryFiles++; continue; }
    let content;
    try { content = decoder.decode(bytes); }
    catch { binaryFiles++; continue; }
    filesChecked++;
    for (const [kind, pattern] of PATTERNS) {
      if (pattern.test(content)) findings.push({ path: relative, kind });
    }
  }
  return { ok: errors.length === 0 && findings.length === 0, listed, filesChecked, binaryFiles, findings, errors };
}

export function summarizeSecretAudit(result) {
  // Never print the secret, matching line, account name or fingerprint.
  const failures = [
    ...result.findings.map(f => 'FAIL secret.' + f.kind + ' [' + f.path + ']'),
    ...result.errors.map(e => 'FAIL secret.read [' + e.path + '] ' + e.code),
  ];
  return [...failures, 'secret-pattern-scan: ' + (result.ok ? 'PASS' : 'FAIL') +
    ' (' + result.findings.length + ' matches, ' + result.errors.length + ' read errors, ' +
    result.filesChecked + ' text files, ' + result.binaryFiles + ' binary files)'].join('\n');
}
