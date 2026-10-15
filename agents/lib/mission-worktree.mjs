import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Runs a git command and returns its trimmed stdout. stderr is piped, never inherited, so a
// failing command throws an Error whose message is git's own diagnostic.
export const defaultGit = (args, cwd) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const MISSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

// realpathSync only works for existing paths; a stateDir that will be created on demand still has
// to be classified, so resolve the nearest existing ancestor and re-append the missing suffix.
const realpathLoose = target => {
  let current = path.resolve(target);
  let suffix = '';
  for (;;) {
    try {
      const resolved = fs.realpathSync(current);
      return suffix ? path.join(resolved, suffix) : resolved;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return suffix ? path.join(current, suffix) : current;
      suffix = suffix ? path.join(path.basename(current), suffix) : path.basename(current);
      current = parent;
    }
  }
};

const normalize = value => (process.platform === 'win32' ? value.toLowerCase() : value);

const assertStateOutside = (stateReal, projectReal) => {
  const target = normalize(stateReal);
  const root = normalize(projectReal);
  if (target === root || target.startsWith(root + path.sep)) throw new Error('STATE_INSIDE_PROJECT');
};

export function createMissionWorktrees({ stateDir, git = defaultGit } = {}) {
  if (typeof stateDir !== 'string' || !stateDir.trim()) throw new Error('STATE_DIR_INVALID');
  const stateRoot = path.resolve(stateDir);

  const pathFor = missionId => {
    if (typeof missionId !== 'string' || !MISSION_ID_PATTERN.test(missionId)) throw new Error('MISSION_ID_INVALID');
    return path.join(stateRoot, 'worktrees', missionId);
  };

  // A mission worktree is only safe when projectRoot is itself the repository root: a subdirectory
  // would make `git worktree add` create the worktree from the wrong place.
  const assertProject = projectRoot => {
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('PROJECT_NOT_GIT_ROOT');
    let resolved;
    try { resolved = fs.realpathSync(projectRoot); } catch { throw new Error('PROJECT_NOT_GIT_ROOT'); }
    let stat;
    try { stat = fs.statSync(resolved); } catch { throw new Error('PROJECT_NOT_GIT_ROOT'); }
    if (!stat.isDirectory()) throw new Error('PROJECT_NOT_GIT_ROOT');
    let toplevel;
    try { toplevel = git(['rev-parse', '--show-toplevel'], resolved); } catch { throw new Error('PROJECT_NOT_GIT_ROOT'); }
    let topResolved;
    try { topResolved = fs.realpathSync(toplevel); } catch { throw new Error('PROJECT_NOT_GIT_ROOT'); }
    if (normalize(topResolved) !== normalize(resolved)) throw new Error('PROJECT_NOT_GIT_ROOT');
    // A worktree needs a commit to branch from.
    try { git(['rev-parse', '--verify', 'HEAD'], resolved); } catch { throw new Error('PROJECT_HAS_NO_COMMITS'); }
    return resolved;
  };

  const guard = (projectRoot, missionId) => {
    const target = pathFor(missionId);
    const project = assertProject(projectRoot);
    assertStateOutside(realpathLoose(stateRoot), project);
    return { target, project };
  };

  const currentBranch = target => {
    try { return git(['-C', target, 'rev-parse', '--abbrev-ref', 'HEAD']); } catch { return ''; }
  };

  const branchExists = (project, name) => {
    try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], project); return true; } catch { return false; }
  };

  return {
    pathFor,
    ensure({ projectRoot, missionId } = {}) {
      const { target, project } = guard(projectRoot, missionId);
      const branchName = `jaco/${missionId}`;
      if (fs.existsSync(target) && currentBranch(target) === branchName) {
        return { path: target, branch: branchName, created: false };
      }
      const base = git(['rev-parse', 'HEAD'], project);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // A branch left behind by remove() is re-attached instead of recreated.
      if (!fs.existsSync(target) && branchExists(project, branchName)) {
        git(['worktree', 'add', target, branchName], project);
      } else {
        git(['worktree', 'add', '-b', branchName, target, 'HEAD'], project);
      }
      return { path: target, branch: branchName, created: true, base };
    },
    remove({ projectRoot, missionId } = {}) {
      const { target, project } = guard(projectRoot, missionId);
      if (!fs.existsSync(target)) return { removed: false };
      // Branch is deliberately kept so a later ensure() re-attaches it with its commits.
      git(['worktree', 'remove', '--force', target], project);
      return { removed: true };
    },
  };
}
