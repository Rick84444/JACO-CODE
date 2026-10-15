import { spawn } from 'child_process';
import http from 'http';

const SERVICES = [
  { name: 'Substrate Agent OS UI', port: 3000, startCmd: 'npx', startArgs: ['tsx', 'src/server/index.ts'] },
  { name: 'Continuum RuntimeHub', port: 3020, startCmd: 'node', startArgs: ['src/server/continuum/standalone-server.mjs'] }
];

const CHECK_INTERVAL_MS = 15000;

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runSentinelCheck() {
  const timestamp = new Date().toISOString();
  console.log(`\n[SENTINEL ${timestamp}] Running autonomous health & self-healing check...`);

  for (const svc of SERVICES) {
    const isAlive = await checkPort(svc.port);
    if (isAlive) {
      console.log(`  [OK] ${svc.name} is HEALTHY on port :${svc.port}`);
    } else {
      console.log(`  [ALERT] ${svc.name} on port :${svc.port} is DOWN! Self-healing trigger engaged...`);
      try {
        const child = spawn(svc.startCmd, svc.startArgs, {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd()
        });
        child.unref();
        console.log(`  [RESTARTED] Successfully spawned ${svc.name} (PID: ${child.pid})`);
      } catch (err) {
        console.error(`  [FAIL] Failed to auto-restart ${svc.name}:`, err.message);
      }
    }
  }
}

console.log('====================================================');
console.log('[JACO PERSISTENT SENTINEL & WAKE-UP WATCHDOG LAUNCHED]');
console.log('====================================================');

runSentinelCheck();
setInterval(runSentinelCheck, CHECK_INTERVAL_MS);
