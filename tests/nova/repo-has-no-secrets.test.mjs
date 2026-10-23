// The tracked repository must not contain key-shaped strings. This is a safety net for contributors, not a
// replacement for a real secret scanner or for rotating a key that was ever committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the pathname is /C:/..., which made this test skip itself.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATTERNS = [
  ['OpenAI-style key', /\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}\b/],
];
// Firebase settings come from VITE_FIREBASE_* variables; no tracked file may hold a Google API key.
const ALLOWED = new Map();

test('no tracked file holds a key-shaped string', { skip: !fs.existsSync(path.join(root, '.git')) && 'not a git checkout' }, () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const hits = [];
  for (const rel of files) {
    if (/^tests\//.test(rel) || /\.(png|jpe?g|gif|webp|mp4|webm|zip|woff2?|ico|lock)$/i.test(rel) || /package-lock\.json$/.test(rel)) continue;
    let text; try { const full = path.join(root, rel); if (!fs.statSync(full).isFile() || fs.statSync(full).size > 3_000_000) continue; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    for (const [label, re] of PATTERNS) {
      if (!re.test(text)) continue;
      const allowed = [...ALLOWED].some(([prefix, set]) => label === 'Google API key' && prefix === 'AIza' && set.has(rel));
      if (!allowed) hits.push(`${rel}: ${label}`);
    }
  }
  assert.deepEqual(hits, [], 'remove the value, rotate the key, and read it from the environment instead');
});
