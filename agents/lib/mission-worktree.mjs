import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Runs a git command and returns its trimmed stdout. stderr is piped, never inherited, so a
// failing command throws an Error whose message is git's own diagnostic.
export const defaultGit = (args, cwd) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
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

/** @param {{stateDir?:string, git?:typeof defaultGit}} [options] */
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
    inspect({ projectRoot, missionId } = {}) {
      const { target, project } = guard(projectRoot, missionId);
      const branch = `jaco/${missionId}`;
      if (!fs.existsSync(target)) return { state: 'NOT_CREATED', branch, files: [], truncated: false };
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('MISSION_WORKTREE_LINK_DENIED');
      const read = (args, cwd = target) => git(['-c', 'core.fsmonitor=false', ...args], cwd);
      const common = cwd => fs.realpathSync(path.resolve(cwd, read(['rev-parse', '--git-common-dir'], cwd)));
      if (normalize(common(target)) !== normalize(common(project)) || read(['branch', '--show-current']) !== branch) throw new Error('MISSION_WORKTREE_MISMATCH');
      const projectHead = read(['rev-parse', 'HEAD'], project);
      const head = read(['rev-parse', 'HEAD']);
      const base = read(['merge-base', head, projectHead]);
      const tracked = read(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base, '--']).split('\0').filter(Boolean);
      const untracked = read(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
      const files = [...new Set([...tracked, ...untracked])];
      return { state: 'READY', path: target, branch, head, base, projectHead, files: files.slice(0, 500).map(name => ({ path: name, untracked: untracked.includes(name) })), truncated: files.length > 500 };
    },
    diff({ projectRoot, missionId, file } = {}) {
      const observed = this.inspect({ projectRoot, missionId });
      const entry = observed.files.find(item => item.path === file);
      if (!entry) throw new Error('MISSION_REVIEW_FILE_NOT_FOUND');
      const options = ['-c', 'core.fsmonitor=false', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color'];
      if (!entry.untracked) return git([...options, observed.base, '--', file], observed.path);
      // git's no-index diff exits 1 when a new file has content. All other errors
      // fail the read; diagnostics must never masquerade as a successful patch.
      try { return git([...options, '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', path.join(observed.path, file)], observed.path); }
      catch (error) { if (error.status === 1 && typeof error.stdout === 'string') return error.stdout; throw error; }
    },
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
