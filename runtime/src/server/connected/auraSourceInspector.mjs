import fs from 'node:fs';
import path from 'node:path';

// Separate read-only access to JACO's own checked-out source. This never grants
// access to model weights, credentials, the OS outside the checkout or write tools.
const SOURCE_DIRS = Object.freeze(['agents', 'runtime', 'gateway', 'tests', 'tools', 'docs', 'extensions', 'lite', 'scripts', 'site']);
const ROOT_FILES = Object.freeze(['README.md', 'CONTRIBUTING.md', 'package.json']);
const EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.css', '.html', '.toml', '.sh', '.ps1', '.cmd']);
const BLOCKED = /^(?:\.git|\.jaco|node_modules|\.env(?:\..*)?|\.npmrc|\.netrc|\.vscode|\.idea|dist|build|coverage)$/i;
const SENSITIVE = /secret|credential|password|private.?key|token|\.pem$|\.key$/i;
const MARKERS = ['package.json', 'runtime/server.ts', 'agents/lib/aura-seer-chat.mjs'];
const MAX_FILE_BYTES = 2_000_000;
const MAX_SEARCH_BYTES = 3_000_000;
const MAX_RESPONSE_CHARS = 16_000;

function safeRelativePath(raw) {
  const value = raw == null || raw === '' ? '.' : String(raw);
  if (value.length > 300 || value.includes('\\') || !/^[A-Za-z0-9_./-]+$/.test(value)) throw new Error('JACO_SOURCE_PATH_INVALID');
  const parts = value.split('/');
  if (parts.some(part => part === '..' || (part.startsWith('.') && part !== '.') || BLOCKED.test(part) || SENSITIVE.test(part))) throw new Error('JACO_SOURCE_PATH_REFUSED');
  const rel = parts.filter(part => part !== '.' && part !== '').join('/') || '.';
  if (rel !== '.' && !SOURCE_DIRS.includes(rel.split('/')[0]) && !ROOT_FILES.includes(rel)) throw new Error('JACO_SOURCE_OUT_OF_SCOPE');
  return rel;
}

function contained(root, full) {
  const rel = path.relative(root, full);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function detectSourceRoot(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const root = fs.realpathSync(candidate);
      if (MARKERS.every(item => fs.statSync(path.join(root, item)).isFile())) return root;
    } catch { /* installed runtime may not include a source checkout */ }
  }
  return null;
}

export function createAuraSourceInspector({ candidateRoots = [] } = {}) {
  const root = detectSourceRoot(candidateRoots);
  return ({ action = 'status', path: requestedPath = '.', query = '', offset = 0, limit = 12_000 } = {}) => {
    const verb = String(action);
    if (verb === 'status') return {
      kind: 'jaco-source-inspection',
      available: root !== null,
      readOnly: true,
      independentOfSelectedWorkspace: true,
      source: root ? 'SOURCE_CHECKOUT_OBSERVED' : 'JACO_SOURCE_CHECKOUT_NOT_AVAILABLE',
      scope: [...SOURCE_DIRS, ...ROOT_FILES].sort(),
      writesAuthorized: false,
    };
    if (!['list', 'read', 'search'].includes(verb)) throw new Error('JACO_SOURCE_ACTION_UNSUPPORTED');
    if (!root) throw new Error('JACO_SOURCE_CHECKOUT_NOT_AVAILABLE');

    const rel = safeRelativePath(requestedPath);
    const candidate = path.resolve(root, rel);
    if (!contained(root, candidate)) throw new Error('JACO_SOURCE_PATH_REFUSED');
    // Reject symlinks (even internal ones) to avoid traversing out of the checkout.
    const segments = rel === '.' ? [] : rel.split('/');
    let current = root;
    for (const segment of segments) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('JACO_SOURCE_SYMLINK_REFUSED');
    }
    const actual = fs.realpathSync(candidate);
    if (!contained(root, actual)) throw new Error('JACO_SOURCE_PATH_REFUSED');
    const st = fs.statSync(actual);
    if (verb === 'list') {
      if (!st.isDirectory()) throw new Error('JACO_SOURCE_NOT_DIRECTORY');
      const entries = fs.readdirSync(actual, { withFileTypes: true })
        .filter(entry => !entry.isSymbolicLink() && !BLOCKED.test(entry.name) && !SENSITIVE.test(entry.name) && !entry.name.startsWith('.'))
        .filter(entry => {
          if (rel === '.') return entry.isDirectory() ? SOURCE_DIRS.includes(entry.name) : ROOT_FILES.includes(entry.name);
          return entry.isDirectory() || (entry.isFile() && EXTENSIONS.has(path.extname(entry.name)));
        })
        .slice(0, 120)
        .map(entry => entry.name + (entry.isDirectory() ? '/' : ''));
      return { source: 'JACO_SOURCE', action: 'list', path: rel, entries };
    }
    if (verb === 'search') {
      const needle = String(query).trim().toLowerCase();
      if (needle.length < 2 || needle.length > 80) throw new Error('JACO_SOURCE_QUERY_INVALID');
      const queue = rel === '.' ? [...SOURCE_DIRS, ...ROOT_FILES].map(name => path.join(root, name)) : [actual];
      let scannedFiles = 0, scannedBytes = 0;
      const matches = [];
      while (queue.length && scannedFiles < 250 && scannedBytes < MAX_SEARCH_BYTES && matches.length < 20) {
        const next = queue.shift();
        let info;
        try { info = fs.lstatSync(next); } catch { continue; }
        if (info.isSymbolicLink()) continue;
        const name = path.basename(next);
        if (BLOCKED.test(name) || SENSITIVE.test(name) || name.startsWith('.')) continue;
        if (info.isDirectory()) {
          if (!contained(root, next)) continue;
          for (const child of fs.readdirSync(next)) queue.push(path.join(next, child));
          continue;
        }
        if (!info.isFile() || !EXTENSIONS.has(path.extname(name)) || info.size > MAX_FILE_BYTES || scannedBytes + info.size > MAX_SEARCH_BYTES) continue;
        scannedFiles++; scannedBytes += info.size;
        const contents = fs.readFileSync(next, 'utf8');
        if (contents.includes('\\0')) continue;
        const lines = contents.split(/\\r?\\n/);
        for (let i = 0; i < lines.length && matches.length < 20; i++) {
          if (lines[i].toLowerCase().includes(needle)) matches.push({
            path: path.relative(root, next).split(path.sep).join('/'), line: i + 1,
            excerpt: lines[i].trim().slice(0, 240),
          });
        }
      }
      return { source: 'JACO_SOURCE', action: 'search', path: rel, query: needle, matches, scannedFiles, truncated: queue.length > 0 || matches.length >= 20 };
    }
    if (!st.isFile() || !EXTENSIONS.has(path.extname(actual))) throw new Error('JACO_SOURCE_FILE_TYPE_REFUSED');
    if (st.size > MAX_FILE_BYTES) throw new Error('JACO_SOURCE_FILE_TOO_LARGE');
    const data = fs.readFileSync(actual, 'utf8');
    if (data.includes('\\0')) throw new Error('JACO_SOURCE_BINARY_REFUSED');
    const start = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const requested = Number.isSafeInteger(Number(limit)) ? Number(limit) : 12_000;
    const count = Math.min(MAX_RESPONSE_CHARS, Math.max(1, requested));
    return {
      source: 'JACO_SOURCE', action: 'read', path: rel, content: data.slice(start, start + count),
      offset: start, totalChars: data.length, truncated: start + count < data.length,
      authority: 'UNTRUSTED_READ_ONLY_SOURCE',
    };
  };
}
