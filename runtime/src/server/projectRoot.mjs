import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, readJson } from './continuum/util.mjs';

const HISTORY_LIMIT = 10;

function isDirectory(target, fsImpl) {
  if (typeof target !== 'string' || !target.trim()) return false;
  try { return fsImpl.statSync(target).isDirectory(); } catch { return false; }
}

function isInsideState(stateRoot, candidate) {
  const rel = path.relative(stateRoot, candidate);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * @param {{ stateDir: string, fallbackRoot: string, env?: Record<string, string | undefined>, fs?: typeof fs }} options
 */
export function createProjectRoot({ stateDir, fallbackRoot, env = process.env, fs: fsImpl = fs }) {
  const stateRoot = path.resolve(stateDir);
  const file = path.join(stateRoot, 'project-root.json');

  function get() {
    // 1. persisted root, while it still exists as a directory
    const saved = readJson(file, null);
    const savedRoot = saved && typeof saved.root === 'string' ? saved.root : null;
    if (savedRoot && isDirectory(savedRoot, fsImpl)) return path.resolve(savedRoot);

    // 2. env override, when set and a directory
    const envRoot = env && typeof env.JACO_PROJECT_ROOT === 'string' ? env.JACO_PROJECT_ROOT.trim() : '';
    if (envRoot && isDirectory(envRoot, fsImpl)) return path.resolve(envRoot);

    // 3. fallback
    if (typeof fallbackRoot === 'string' && fallbackRoot.trim()) return path.resolve(fallbackRoot);
    return fallbackRoot;
  }

  function set(candidate) {
    const raw = typeof candidate === 'string' ? candidate.trim() : '';
    if (!raw || raw.includes('\0') || !path.isAbsolute(raw)) throw new Error('PROJECT_ROOT_NOT_DIRECTORY');
    const resolved = path.resolve(raw);
    if (!isDirectory(resolved, fsImpl)) throw new Error('PROJECT_ROOT_NOT_DIRECTORY');
    if (isInsideState(stateRoot, resolved)) throw new Error('PROJECT_ROOT_INSIDE_STATE');

    const previous = history();
    const nextHistory = [resolved, ...previous.filter((item) => item !== resolved)].slice(0, HISTORY_LIMIT);
    atomicWriteJson(file, { root: resolved, setAt: new Date().toISOString(), history: nextHistory });
    return resolved;
  }

  function resolve(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new Error('PATH_OUTSIDE_PROJECT');
    const root = get();
    if (typeof root !== 'string' || !root) throw new Error('PATH_OUTSIDE_PROJECT');
    const base = path.resolve(root);
    const target = path.resolve(base, relativePath);
    const rel = path.relative(base, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('PATH_OUTSIDE_PROJECT');
    return target;
  }

  function history() {
    const saved = readJson(file, null);
    const list = saved && Array.isArray(saved.history) ? saved.history : [];
    return list.filter((item) => typeof item === 'string').slice(0, HISTORY_LIMIT);
  }

  return { get, set, resolve, history };
}
