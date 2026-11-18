import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Pixel AVF is Linux arm64 Debian, not Android's host or Termux.
export function pixelDebian(env = process.env, { platform = process.platform, arch = process.arch, osRelease } = {}) {
  if (env.JACO_PIXEL_SETUP === '0' || env.TERMUX_VERSION || String(env.PREFIX || '').includes('com.termux')) return false;
  if (platform !== 'linux' || arch !== 'arm64') return false;
  try { osRelease ??= fs.readFileSync('/etc/os-release', 'utf8'); }
  catch { return false; }
  return /^ID=["']?(debian|ubuntu)["']?\s*$/m.test(osRelease);
}
function browserPath(env) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const choices = env.JACO_CHROME_EXECUTABLE ? [path.resolve(env.JACO_CHROME_EXECUTABLE)] :
    ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'].flatMap(n => dirs.map(d => path.join(d, n)));
  return choices.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
}
export function preparePixelBrowser(root, env, { spawn = spawnSync, logger = console, uid = process.getuid?.(), find = browserPath } = {}) {
  if (env.JACO_ENABLE_CDP === '0') return { state: 'DISABLED' };
  const options = { cwd: root, env, stdio: 'inherit' };
  const verify = () => {
    const exe = find(env);
    return !!exe && spawn(exe, ['--version'], options).status === 0;
  };
  if (verify()) return { state: 'INSTALLED' };
  if (env.JACO_CHROME_EXECUTABLE) return { state: 'UNAVAILABLE', reason: 'CONFIGURED_BROWSER_UNUSABLE' };
  if (env.JACO_SETUP_INSTALL_BROWSER === '0') return { state: 'UNAVAILABLE', reason: 'INSTALL_DISABLED' };
  // Use the distribution's signed packages, with normal sudo authorization.
  // Never run an untrusted downloader, alter sudo policy or disable Chromium sandbox.
  const packageManager = uid === 0 ? { cmd: 'apt-get', args: [] } : { cmd: 'sudo', args: ['apt-get'] };
  logger.log('Preparing Chromium for Aura CDP (Debian arm64)');
  for (const args of [['update'], ['install', '-y', 'chromium']]) {
    const result = spawn(packageManager.cmd, [...packageManager.args, ...args], options);
    if (result.status !== 0) return { state: 'UNAVAILABLE', reason: 'CHROMIUM_PACKAGE_INSTALL_FAILED' };
  }
  return verify() ? { state: 'INSTALLED' } : { state: 'UNAVAILABLE', reason: 'CHROMIUM_VERSION_PROBE_FAILED' };
}
export function activatePixelInstallation(root, env, { spawn = spawnSync, logger = console, read = fs.readFileSync, now = Date.now } = {}) {
  if (env.JACO_SETUP_ACTIVATE === '0') return { state: 'NOT_REQUESTED' };
  const since = now();
  const result = spawn(process.execPath, ['agents/lib/local-stack.mjs'], { cwd: root, env, stdio: 'inherit' });
  if (result.error) return { state: 'BLOCKED', reason: 'LAUNCH_FAILED' };
  let receipt;
  try {
    receipt = JSON.parse(read(path.join(env.JACO_DATA_DIR || root, 'logs/startup/status.json'), 'utf8'));
  } catch { return { state: 'BLOCKED', reason: 'STARTUP_RECEIPT_MISSING' }; }
  if (receipt.schema !== 'jaco.local-startup/v1' || !Number.isInteger(result.pid) ||
      !String(receipt.runId || '').startsWith(result.pid + '-') ||
      !(Date.parse(receipt.startedAt) >= since) || receipt.phase !== 'complete' ||
      ![0,1].includes(result.status) || !['READY','DEGRADED'].includes(receipt.state) ||
      !['runtime','workplace','seer','nova'].every(id => receipt.services?.some(s => s.id === id && s.state === 'READY'))) {
    return { state: 'BLOCKED', reason: 'CORE_READINESS_UNVERIFIED' };
  }
  const browserReady = receipt.browserAttachment === 'ATTACHED' &&
    ['novaBridge','cdp'].every(id => receipt.services.some(s => s.id === id && s.state === 'READY'));
  const browser = env.JACO_ENABLE_CDP === '0' ? 'DISABLED' : browserReady ? 'READY' : 'UNAVAILABLE';
  logger.log('Pixel activation: '+receipt.state+'; CDP: '+browser);
  const runtime = receipt.services.find(s => s.id === 'runtime');
  logger.log('Open JACO in Pixel Chrome: '+new URL(runtime.url).origin);
  return { state: receipt.state, browser };
}
