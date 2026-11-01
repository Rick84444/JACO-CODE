import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTALL_SCHEMA = 'jaco.windows-install/v1';
export const PAYLOAD_SCHEMA = 'jaco.windows-payload/v1';
export const BUILD_ID = /^[a-z0-9][a-z0-9._-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

export function installationPipe(root, platform = process.platform) {
  const digest = sha(path.resolve(root).toLowerCase()).slice(0, 28);
  return platform === 'win32' ? `\\\\.\\pipe\\jaco-desktop-${digest}` : path.join(root, `.desktop-${digest}.sock`);
}

function safeRelative(relative) {
  return typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative)
    && !relative.includes('\\') && !relative.includes(':') && !relative.includes('\0')
    && !relative.split('/').some(part => !part || part === '.' || part === '..');
}

export function filesUnder(root) {
  const files = [];
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelative(relative) || entry.isSymbolicLink()) throw new Error('PAYLOAD_UNSAFE_PATH');
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error('PAYLOAD_UNSUPPORTED_FILE');
    }
  };
  walk(root);
  return files.sort();
}

export function verifyPayload(payload) {
  if (fs.lstatSync(payload).isSymbolicLink()) throw new Error('PAYLOAD_LINK_REFUSED');
  const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'installer-manifest.json'), 'utf8'));
  if (manifest.schema !== PAYLOAD_SCHEMA || !BUILD_ID.test(manifest.buildId || '')
    || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit || '') || !['x64', 'arm64'].includes(manifest.arch)
    || !Array.isArray(manifest.files) || manifest.files.length < 5) throw new Error('PAYLOAD_MANIFEST_INVALID');
  const expected = new Set(['installer-manifest.json']);
  for (const item of manifest.files) {
    if (!safeRelative(item.path) || expected.has(item.path) || !HASH.test(item.sha256 || '')
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('PAYLOAD_MANIFEST_INVALID');
    expected.add(item.path);
  }
  const observed = filesUnder(payload);
  if (observed.length !== expected.size || observed.some(file => !expected.has(file))) throw new Error('PAYLOAD_FILES_CHANGED');
  for (const item of manifest.files) {
    const data = fs.readFileSync(path.join(payload, ...item.path.split('/')));
    if (data.length !== item.bytes || sha(data) !== item.sha256) throw new Error(`PAYLOAD_CHECKSUM_MISMATCH:${item.path}`);
  }
  return manifest;
}

export function readCurrent(root) {
  const file = path.join(root, 'current.json');
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('INSTALL_POINTER_LINK_REFUSED');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (current.schema !== INSTALL_SCHEMA || !BUILD_ID.test(current.buildId || '')
    || (current.previousBuildId !== null && current.previousBuildId !== undefined && !BUILD_ID.test(current.previousBuildId)))
    throw new Error('INSTALL_POINTER_INVALID');
  return current;
}

// Stable versions compare above their prereleases; numeric identifiers compare numerically.
export function compareVersions(a, b) {
  const parse = value => {
    const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value));
    if (!m) throw new Error('INSTALL_VERSION_INVALID');
    return { parts: m.slice(1, 4).map(BigInt), pre: m[4]?.split('.') ?? [] };
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function requestDesktop(root, action = 'status', timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(installationPipe(root));
    let text = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; connection.destroy();
      error ? reject(error) : resolve(value);
    };
    connection.setTimeout(timeoutMs, () => finish(new Error('DESKTOP_STATUS_UNKNOWN')));
    connection.once('connect', () => connection.write(JSON.stringify({ action }) + '\n'));
    connection.on('data', chunk => {
      text += chunk;
      if (text.length > 2048) return finish(new Error('DESKTOP_RESPONSE_INVALID'));
      if (text.includes('\n')) {
        try {
          const response = JSON.parse(text.split('\n')[0]);
          if (response.schema !== 'jaco.desktop-control/v1') throw new Error('DESKTOP_RESPONSE_INVALID');
          finish(null, response);
        } catch (error) { finish(error); }
      }
    });
    connection.once('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(null, null);
      else finish(new Error('DESKTOP_STATUS_UNKNOWN', { cause: error }));
    });
    connection.once('end', () => { if (!settled) finish(new Error('DESKTOP_RESPONSE_INCOMPLETE')); });
  });
}

function ensureRealDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) throw new Error('INSTALL_DIRECTORY_UNSAFE');
}

export function activatePayload(root, payload) {
  root = path.resolve(root); payload = path.resolve(payload);
  const manifest = verifyPayload(payload);
  const versions = path.join(root, 'versions');
  ensureRealDirectory(root); ensureRealDirectory(versions);
  const target = path.join(versions, manifest.buildId);
  if (![target, path.join(versions, `.pending-${manifest.buildId}`)].includes(payload)) throw new Error('INSTALL_PAYLOAD_LOCATION_INVALID');
  const current = readCurrent(root);
  if (current) {
    const old = verifyPayload(path.join(versions, current.buildId));
    if (old.arch !== manifest.arch) throw new Error('INSTALL_ARCHITECTURE_CHANGE_REFUSED');
    if (compareVersions(manifest.version, old.version) < 0) throw new Error('INSTALL_DOWNGRADE_REFUSED');
  }
  if (payload !== target) {
    if (fs.existsSync(target)) {
      const installed = verifyPayload(target);
      if (JSON.stringify(installed) !== JSON.stringify(manifest)) throw new Error('INSTALL_BUILD_COLLISION');
      fs.rmSync(payload, { recursive: true });
    } else fs.renameSync(payload, target);
  }
  const pointer = {
    schema: INSTALL_SCHEMA, buildId: manifest.buildId, version: manifest.version, arch: manifest.arch,
    sourceCommit: manifest.sourceCommit, installedAt: new Date().toISOString(),
    previousBuildId: current && current.buildId !== manifest.buildId ? current.buildId : current?.previousBuildId ?? null,
  };
  const temporary = path.join(root, `current-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(pointer, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(root, 'current.json'));
  } finally { fs.rmSync(temporary, { force: true }); }
  return pointer;
}

export async function installAction(action, root, payload) {
  const running = await requestDesktop(root);
  if (action === 'prepare-uninstall') {
    if (!readCurrent(root)) throw new Error('INSTALL_POINTER_MISSING');
    if (running) {
      const stopped = await requestDesktop(root, 'stop');
      if (!stopped?.accepted) throw new Error('JACO_IS_STARTING_RETRY');
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (!await requestDesktop(root)) return;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new Error('JACO_IS_RUNNING_CLOSE_FIRST');
    }
    return;
  }
  if (action !== 'activate') throw new Error('INSTALL_ACTION_INVALID');
  if (running) throw new Error('JACO_IS_RUNNING_CLOSE_FIRST');
  return activatePayload(root, payload);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, root, payload] = process.argv.slice(2);
  try {
    if (action === 'verify') verifyPayload(root);
    else if (root) await installAction(action, root, payload);
    else throw new Error('INSTALL_ARGUMENT_REQUIRED');
  } catch (error) {
    // Error codes and paths only. The installer never reads or prints provider credentials.
    process.stderr.write(`JACO setup: ${error.message}\n`);
    if (root && action !== 'verify') {
      try { fs.writeFileSync(path.join(root, 'setup-error.txt'), `${error.message}\n`); } catch { /* best effort */ }
    }
    process.exitCode = /JACO_IS_(RUNNING|STARTING)/.test(error.message) ? 10 : 1;
  }
}
