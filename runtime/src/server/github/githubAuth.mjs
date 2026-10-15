import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Authentication belongs to Git Credential Manager. JACO never accepts or stores the token.
export function createGithubAuth({ run = execFileAsync, launch = spawn } = {}) {
  let login = null;
  let lastError = null;
  async function status() {
    try {
      const { stdout } = await run('git', ['credential-manager', 'github', 'list'], {
        windowsHide: true, timeout: 10_000, env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' },
      });
      const accounts = String(stdout).split(/\r?\n/).map(x => x.trim()).filter(x => /^[A-Za-z0-9-]{1,39}$/.test(x));
      return { available: true, accounts, credentialStored: accounts.length > 0, loginInProgress: Boolean(login), lastError };
    } catch (error) {
      return { available: false, accounts: [], credentialStored: false, loginInProgress: Boolean(login), lastError: String(error?.code || error?.message || error).slice(0, 160) };
    }
  }
  async function startLogin() {
    if (login) return { started: false, reason: 'GITHUB_LOGIN_ALREADY_RUNNING' };
    lastError = null;
    const child = launch('git', ['credential-manager', 'github', 'login', '--browser'], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    login = child;
    child.once('error', error => { lastError = String(error?.message || error).slice(0, 160); login = null; });
    child.once('exit', code => { if (code !== 0) lastError = `GITHUB_LOGIN_EXIT_${code}`; login = null; });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', error => reject(new Error(`GITHUB_LOGIN_LAUNCH_FAILED:${error.code || 'UNKNOWN'}`)));
    });
    return { started: true, method: 'git-credential-manager-browser' };
  }
  return { status, startLogin };
}
