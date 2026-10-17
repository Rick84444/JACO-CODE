// One command for a working checkout: install the root package, then install and build the runtime.
// The runtime directory is resolved rather than assumed, because its name still differs between
// checkouts until the migration to runtime/ is complete, and a wrong guess left the previous
// instructions pointing at a directory that does not exist.
// Runs on a fresh clone, so it imports nothing outside node: builtins.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDirectory } from '../agents/lib/runtime-directory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, cwd) {
  process.stdout.write(`\n[setup] npm ${args.join(' ')} (${cwd})\n`);
  return spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
}

function must(args, cwd) {
  if (run(args, cwd)) return;
  process.stderr.write(`\n[setup] failed: npm ${args.join(' ')} in ${cwd}\n`);
  process.exit(1);
}

if (Number(process.versions.node.split('.')[0]) < 24) {
  process.stderr.write(`[setup] NODE_24_OR_NEWER_REQUIRED: this is Node ${process.versions.node}\n`);
  process.exit(1);
}

must(['install', '--no-audit', '--no-fund'], ROOT);

let runtime;
try { runtime = runtimeDirectory(ROOT, process.env.JACO_RUNTIME_DIR); }
catch (error) { process.stderr.write(`[setup] ${error.message}\n`); process.exit(1); }
process.stdout.write(`\n[setup] runtime: ${runtime}\n`);

// npm ci is the locked install; fall back to npm install when the lockfile cannot serve it.
if (!fs.existsSync(path.join(runtime, 'package-lock.json')) || !run(['ci', '--no-audit', '--no-fund'], runtime)) {
  must(['install', '--no-audit', '--no-fund'], runtime);
}
must(['run', 'build'], runtime);

// The stack refuses to start without a gateway token of at least 24 characters, and it is the
// operator's local credential, so setup generates one into the gitignored .env rather than
// leaving a first run to fail on it. An existing value is never replaced and never printed.
function ensureGatewayToken() {
  const file = path.join(ROOT, '.env');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = current.split(/\r?\n/).find(l => /^\s*JACO_GATEWAY_TOKEN\s*=/.test(l));
  if (line) {
    const value = line.slice(line.indexOf('=') + 1).trim();
    if (value.length < 24) process.stdout.write('\n[setup] JACO_GATEWAY_TOKEN in .env is shorter than 24 characters; the stack will refuse to start. Replace it.\n');
    else process.stdout.write('\n[setup] JACO_GATEWAY_TOKEN already set in .env; kept.\n');
    return;
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${prefix}JACO_GATEWAY_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  process.stdout.write('\n[setup] generated JACO_GATEWAY_TOKEN into .env (gitignored; value not printed).\n');
}
ensureGatewayToken();

process.stdout.write('\n[setup] done. Start it with: npm run jaco:start\n');
