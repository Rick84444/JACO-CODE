import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Scans what git would publish: tracked files plus untracked files that are not ignored.
// Ignored files (.env, build outputs) stay local and are not a leak.
const root = process.cwd();
const patterns = [
  ['openai', /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['huggingface', /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{20,}/],
  ['github', /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/],
  ['stripe-live', /(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
  ['google-api', /AIza[0-9A-Za-z_-]{30,}/],
  ['cloudflare', /(?<![A-Za-z0-9])cf[au]t_[A-Za-z0-9_-]{30,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const ignoreFiles = new Set(['package-lock.json', 'bun.lock']);
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);
const hits = [];
for (const file of files) {
  if (ignoreFiles.has(path.basename(file))) continue;
  let text; try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  for (const [kind, regex] of patterns) if (regex.test(text)) hits.push({ kind, file });
}
for (const hit of hits) console.log(`FAIL secret.${hit.kind} [${hit.file}]`);
console.log(`secret-pattern-scan: ${hits.length ? 'FAIL' : 'PASS'} (${hits.length} hits, ${files.length} files)`);
if (hits.length) process.exit(1);
