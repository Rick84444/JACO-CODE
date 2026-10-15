import fs from 'node:fs';
import net from 'node:net';

const release = JSON.parse(fs.readFileSync(new URL('../CURRENT_RELEASE.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT || release.primaryPort || 3000);
const host = process.env.JACO_PREFLIGHT_HOST || '127.0.0.1';
const base = `http://${host}:${port}`;

async function fetchIdentity() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${base}/api/runtime/identity`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (value) => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(900);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

// Exit codes: 0 port free, 10 current JACO already running, 20 port held by something else.
// process.exitCode instead of process.exit(): exiting while the fetch handle closes trips a libuv
// assertion on Windows (Node 24).
const open = await portOpen();
if (!open) {
  console.log(JSON.stringify({ status: 'PORT_FREE', host, port, releaseId: release.releaseId }));
  process.exitCode = 0;
} else {
  const identity = await fetchIdentity();
  const actual = identity?.identity || identity;
  if (actual?.releaseId === release.releaseId && actual?.canonicalGui === release.canonicalGui) {
    console.log(JSON.stringify({ status: 'CURRENT_JACO_ALREADY_RUNNING', host, port, identity: actual }));
    process.exitCode = 10;
  } else {
    console.error(JSON.stringify({
      status: 'PORT_OCCUPIED_BY_OTHER_RUNTIME', host, port,
      expected: { releaseId: release.releaseId, canonicalGui: release.canonicalGui },
      observed: actual || null,
    }));
    process.exitCode = 20;
  }
}
