import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installationPipe, readCurrent, requestDesktop, verifyPayload } from './install-state.mjs';

const payload = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(payload, '..', '..');
const data = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'JACO');
const workspace = path.resolve(process.env.JACO_WORKSPACE_ROOT || path.join(data, 'workspace'));
const logs = path.join(data, 'logs');
fs.mkdirSync(logs, { recursive: true });
const logFile = path.join(logs, 'desktop-startup.log');
const log = line => fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

function validLocalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password; }
  catch { return false; }
}

async function launch() {
  const action = process.argv.includes('--stop') ? 'stop' : process.argv.includes('--status') ? 'status' : 'open';
  if (process.argv.slice(2).some(arg => !['--stop', '--status', '--check'].includes(arg))) throw new Error('Unsupported launch option');
  const existing = await requestDesktop(root, action);
  if (existing) {
    if (action === 'stop' && !existing.accepted) throw new Error('JACO is still starting. Try Stop JACO again in a moment.');
    if (action === 'status') process.stdout.write(JSON.stringify(existing) + '\n');
    return;
  }
  if (action !== 'open') return;
  const manifest = verifyPayload(payload);
  if (readCurrent(root)?.buildId !== manifest.buildId) throw new Error('Installation changed. Start JACO again from the Start menu.');
  const { main, openBrowser } = await import('./app/start.mjs');
  const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const env = { ...process.env, JACO_REQUIRE_SETUP: '1', JACO_LITE_NO_UPDATE_CHECK: '1', JACO_DESKTOP_INSTALL: '1' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  // Make the bundled npm/npx and Git available only to JACO and its children, never the system PATH.
  env.PATH = [path.join(payload, 'node'), path.join(payload, 'git/cmd'), inheritedPath].join(path.delimiter);
  if (process.argv.includes('--check')) {
    process.exitCode = await main([workspace, '--check'], { env, installDir: path.join(payload, 'app') });
    return;
  }

  // This only prevents duplicate desktop launchers. The canonical runtime launcher owns every service.
  let url = null;
  let stopping = false;
  const controller = net.createServer(connection => {
    let input = '';
    connection.setTimeout(2000, () => connection.destroy());
    connection.on('data', chunk => {
      input += chunk;
      if (input.length > 1024) return connection.destroy();
      if (!input.includes('\n')) return;
      let request;
      try { request = JSON.parse(input.split('\n')[0]); } catch { return connection.destroy(); }
      if (!['open', 'stop', 'status'].includes(request.action)) return connection.destroy();
      connection.removeAllListeners('data');
      const accepted = request.action === 'stop' && url !== null;
      connection.end(JSON.stringify({ schema: 'jaco.desktop-control/v1', running: true, ready: url !== null && !stopping, accepted, url,
        version: manifest.version, sourceCommit: manifest.sourceCommit }) + '\n');
      if (request.action === 'open' && url && !stopping) openBrowser(url);
      if (accepted && !stopping) {
        stopping = true;
        // Invoke the canonical launcher's registered shutdown handler; do not kill arbitrary Node processes.
        setImmediate(() => process.emit('SIGTERM'));
      }
    });
  });
  try {
    await new Promise((resolve, reject) => { controller.once('error', reject); controller.listen(installationPipe(root), resolve); });
  } catch (error) {
    controller.close();
    if (error.code === 'EADDRINUSE') {
      if (await requestDesktop(root, 'open')) return;
    }
    throw error;
  }
  log(`Starting JACO ${manifest.version} (${manifest.sourceCommit}); workspace ${workspace}`);
  try {
    process.exitCode = await main([workspace], {
      env, installDir: path.join(payload, 'app'), cwd: workspace,
      out: log, err: log,
      open: address => {
        if (!validLocalUrl(address)) throw new Error('Runtime returned an invalid local address');
        url = address;
        openBrowser(address);
      },
    });
    if (process.exitCode) throw new Error(`JACO stopped with exit code ${process.exitCode}.`);
  } finally {
    // Keep status available until this owner and its child handles have actually exited.
    // An unreferenced pipe does not keep the owner alive; Windows releases it on process exit.
    stopping = true;
    if (controller.listening) controller.unref();
  }
}

launch().catch(error => {
  log(String(error?.stack || error));
  process.exitCode = 1;
  // wscript receives a path as one argument; no secret, script body or shell interpolation is used.
  const child = spawn('wscript.exe', [path.join(payload, 'startup-error.vbs'), logFile], { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {}); child.unref();
});
