import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', '.ssh']);
const FORBIDDEN_BASENAMES = [
  /^\.env(?:\..+)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /\.(?:pem|p12|pfx|key)$/i,
  /^(?:credentials|service-account).*\.json$/i,
];

export interface ResolvedWorkspacePath {
  root: string;
  absolutePath: string;
  relativePath: string;
  exists: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const relation = path.relative(root, candidate);
  return relation === '' || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation));
}

function canonicalExistingParent(candidate: string): string {
  let cursor = candidate;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return fs.realpathSync(cursor);
}

export function resolveWorkspaceFile(
  workspaceRoot: string,
  requestedPath: string,
  options: { allowMissing?: boolean; allowDirectory?: boolean } = {},
): ResolvedWorkspacePath {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw new Error('workspace path is required');
  if (requestedPath.includes('\0')) throw new Error('workspace path contains a null byte');
  if (path.isAbsolute(requestedPath)) throw new Error('absolute paths are forbidden');

  const root = fs.realpathSync(workspaceRoot);
  const normalized = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) throw new Error(`protected workspace segment in path: ${requestedPath}`);
  const basename = segments.at(-1) || '';
  if (FORBIDDEN_BASENAMES.some((pattern) => pattern.test(basename))) throw new Error(`secret-bearing file is protected: ${requestedPath}`);

  const absolutePath = path.resolve(root, normalized);
  if (!isInside(root, absolutePath)) throw new Error(`path escapes workspace: ${requestedPath}`);
  const exists = fs.existsSync(absolutePath);
  if (!exists && !options.allowMissing) throw new Error(`workspace path does not exist: ${requestedPath}`);

  if (exists) {
    const real = fs.realpathSync(absolutePath);
    if (!isInside(root, real)) throw new Error(`symlink escapes workspace: ${requestedPath}`);
    const stat = fs.statSync(real);
    if (stat.isDirectory() && !options.allowDirectory) throw new Error(`expected a file, got directory: ${requestedPath}`);
    if (!stat.isDirectory() && options.allowDirectory) throw new Error(`expected a directory: ${requestedPath}`);
  } else {
    const realParent = canonicalExistingParent(path.dirname(absolutePath));
    if (!isInside(root, realParent)) throw new Error(`parent symlink escapes workspace: ${requestedPath}`);
  }

  return { root, absolutePath, relativePath: path.relative(root, absolutePath).replace(/\\/g, '/'), exists };
}

export function sha256(content: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}
