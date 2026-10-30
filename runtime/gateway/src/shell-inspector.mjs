// Explicitly bounded local diagnostic operations for the Aura MCP gateway.
// This is NOT a general shell. Mutating terminal tasks remain in Aura's mandate-gated runtime.
// GitHub bootstrap issues never invoke this module.
const OPERATIONS = Object.freeze({
  git_status: ['git', ['status', '--short', '--untracked-files=no']],
  git_diff_stat: ['git', ['diff', '--stat', '--no-ext-diff']],
  git_recent_commits: ['git', ['log', '-5', '--format=%h %s']],
  node_version: ['node', ['--version']],
  npm_version: ['npm', ['--version']],
});
const clean = (value, max = 10000) => String(value || '').slice(0, max);

export function shellInspectionOptions() {
  return Object.keys(OPERATIONS);
}

export async function inspectShell(operation, system, { enabled = process.env.JACO_MCP_SHELL_INSPECT === '1' } = {}) {
  if (!enabled) throw Error('JACO_MCP_SHELL_INSPECT_DISABLED');
  if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) throw Error('SHELL_INSPECT_OPERATION_DENIED');
  if (!system?.runFile || !system?.repoRoot) throw Error('JACO_SHELL_INSPECT_HOST_UNAVAILABLE');
  const [bin, args] = OPERATIONS[operation];
  const command = bin === 'git' ? system.gitBin || 'git' : bin;
  const finalArgs = bin === 'git' ? ['-C', system.repoRoot, ...args] : args;
  // Do not hand gateway/provider/token secrets to diagnostic child processes.
  const allowed = ['PATH','Path','HOME','USERPROFILE','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','TMPDIR',
    'APPDATA','LOCALAPPDATA','PATHEXT','COMSPEC','ComSpec','HOMEDRIVE','HOMEPATH'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  let result;
  try {
    result = await system.runFile(command, finalArgs, {
      cwd: system.repoRoot, env, timeout: 10000, maxBuffer: 12000,
      windowsHide: true, shell: false,
    });
  } catch (error) {
    return { operation, ok:false, exitCode:Number.isInteger(error?.code) ? error.code : null,
      error:'INSPECTION_COMMAND_FAILED', stdout:clean(error?.stdout), stderr:'' };
  }
  return { operation, ok:true, exitCode:0, stdout:clean(result.stdout), stderr:clean(result.stderr,2000) };
}
