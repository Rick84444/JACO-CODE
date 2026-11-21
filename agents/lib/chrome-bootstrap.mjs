import fs from 'node:fs';
import path from 'node:path';

export function executable(env, configured, name, candidates = []) {
  const paths = configured ? [path.resolve(configured)] : [...candidates, ...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map(p => path.join(p.replace(/^"|"$/g, ''), name))];
  return paths.find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}
export function chromeExecutable(env, platform = process.platform) {
  if (env.JACO_CHROME_EXECUTABLE) return executable(env, env.JACO_CHROME_EXECUTABLE, '');
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
    // Use the same CDP protocol and private JACO profile, including on Windows
    // systems with Edge but no separately installed Chrome.
    return executable(env, null, 'chrome.exe', roots.map(p => path.join(p, 'Google/Chrome/Application/chrome.exe')))
      || executable(env, null, 'msedge.exe', roots.map(p => path.join(p, 'Microsoft/Edge/Application/msedge.exe')));
  }
  const names = platform === 'darwin' ? ['google-chrome', 'chromium'] : ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
  if (platform === 'darwin') {
    const mac = executable(env, null, 'Google Chrome', ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']);
    if (mac) return mac;
  }
  for (const name of names) {
    const found = executable(env, null, name);
    if (found) return found;
  }
  return null;
}
export function chromeLaunchArgs(c, platform = process.platform) {
  const profile = c.env.JACO_CHROME_PROFILE_DIR || path.join(c.dataRoot || c.root, 'Chrome-CDP');
  if (!profile) throw new Error('CHROME_PROFILE_DIR_REQUIRED');
  const headless = c.env.JACO_CHROME_HEADLESS === '1' ||
    (c.env.JACO_CHROME_HEADLESS !== '0' && platform === 'linux' && !c.env.DISPLAY && !c.env.WAYLAND_DISPLAY);
  return [`--remote-debugging-port=${c.ports.chrome}`, '--remote-debugging-address=127.0.0.1',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    `--user-data-dir=${path.resolve(c.root, profile)}`,
    ...(headless ? ['--headless=new'] : []), c.env.JACO_BROWSER_START_URL || 'https://www.google.com/'];
}
