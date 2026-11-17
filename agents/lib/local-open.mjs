// Opening a local folder or file in Windows Explorer, for the operator's own GUI only.
// Only paths inside an allowed root (the project, the JACO data folder, the install folder) are opened.
// Arguments go to explorer.exe as an array with no shell, so a path cannot inject a command.
import fs from 'node:fs';
import path from 'node:path';

const inside = (child, root) => child === root || child.startsWith(root + path.sep);

export function resolveOpenTarget(requested, allowedRoots = []) {
  if (typeof requested !== 'string' || !requested.trim() || requested.length > 1000) throw new Error('OPEN_PATH_INVALID');
  if (requested.includes('\0')) throw new Error('OPEN_PATH_INVALID');
  const target = path.resolve(requested.trim());
  const roots = allowedRoots.filter(Boolean).map(r => fs.realpathSync(path.resolve(r)));
  if (roots.length === 0) throw new Error('OPEN_ROOTS_MISSING');
  if (!fs.existsSync(target)) throw new Error('OPEN_PATH_NOT_FOUND');
  const real = fs.realpathSync(target);
  if (!roots.some(root => inside(real, root))) throw new Error('OPEN_PATH_OUTSIDE_ALLOWED_ROOTS');
  const isDirectory = fs.statSync(real).isDirectory();
  return { path: real, mode: isDirectory ? 'folder' : 'select' };
}

// explorer.exe opens a folder directly, or selects a file inside its folder.
export function explorerArgs(target) {
  return target.mode === 'select' ? ['/select,' + target.path] : [target.path];
}
