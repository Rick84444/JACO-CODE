#!/usr/bin/env node
// Live verification of every Nova Bridge function against a running instance.
//
// This is a runtime check, not a unit test: it proves what Nova actually does
// on this host right now. It is read-only and never actuates the page — the
// mutation endpoints are probed only far enough to confirm their policy gate.
//
// Exit 0 = verified. --allow-skip is an explicit optional diagnostic mode.
// This live script is intentionally outside the offline *.test.mjs regression glob.
// Exit 1 = Nova answered, but a required invariant did not hold.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.NOVA_URL || `http://127.0.0.1:${process.env.NOVA_BRIDGE_PORT || 4243}`;

function tokenFromEnvFile() {
  const file = join(root, '.env');
  if (!existsSync(file)) return '';
  const m = /^JACO_GATEWAY_TOKEN=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1].trim() : '';
}
const TOKEN = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || tokenFromEnvFile();

// An explicit controller is used instead of AbortSignal.timeout so the timer
// handle is always cleared, and `connection: close` keeps fetch from holding
// keep-alive sockets open. Either one left pending trips a libuv assertion on
// Windows when the process exits.
async function call(method, path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', connection: 'close', Authorization: `Bearer ${TOKEN}`, ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    return { status: r.status, data };
  } catch (error) {
    return { status: 0, data: { error: error.message } };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${detail}`);
};

const reachable = await call('GET', '/health');
if (reachable.status === 0) {
  console.log(`SKIP  Nova Bridge not reachable at ${BASE} — start it with agents/start-all.ps1`);
  process.exit(process.argv.includes('--allow-skip') ? 0 : 1);
}
if (!TOKEN) {
  console.log('SKIP  no JACO_GATEWAY_TOKEN available');
  process.exit(process.argv.includes('--allow-skip') ? 0 : 1);
}

console.log(`=== NOVA BRIDGE LIVE FUNCTIONS === ${BASE}\n`);

// Security invariants. Order matters: nova-bridge checks auth, then the
// Workplace gate, then Origin, so an unsynced Nova masks the Origin check.
const noAuth = await fetch(BASE + '/observe', { headers: { connection: 'close' } }).then(r => r.status).catch(() => 0);
record('auth gate', noAuth === 401, noAuth === 401 ? 'unauthenticated rejected 401' : `expected 401, got ${noAuth}`);

const workplaceBlocked = /WORKPLACE_UNSYNCED/.test(JSON.stringify((await call('GET', '/targets')).data));
if (workplaceBlocked) {
  record('workplace session', false, 'DEGRADED_UNSYNCED — Nova needs a READY Workplace session; tools stay disabled');
  console.log('\nRESULT: FAIL (restart Nova with JACO_WORKPLACE_URL set)');
  process.exit(1);
}
record('workplace session', true, 'READY — tools enabled');

const origin = await call('GET', '/observe', null, { Origin: 'https://evil.example' });
record('browser-origin gate', origin.status === 403, origin.status === 403 ? 'Origin header rejected 403' : `expected 403, got ${origin.status}`);

// Capability surface.
record('/health', reachable.data?.ok === true, `cdpPort=${reachable.data?.cdpPort} cdpPageReachable=${reachable.data?.ok}`);

const targets = await call('GET', '/targets');
const tabs = targets.data?.tabs || [];
record('/targets', targets.data?.ok === true, `${tabs.length} allowed tab(s)`);

// Nova binds to exactly one allowed tab. More than one is ambiguous and it
// refuses rather than guessing, which is the intended safety behaviour.
const ambiguous = false; // Nova now works in its own tab, so several IDE tabs are no longer ambiguous.
for (const path of ['/observe', '/screenshot']) {
  const r = await call('GET', path);
  const refusedForAmbiguity = /SET_CDP_TARGET_ID_OR_OPEN_ONE_ALLOWED_TAB/.test(JSON.stringify(r.data));
  if (ambiguous && refusedForAmbiguity) {
    record(path, true, `refused by design: ${tabs.length} allowed tabs, no CDP_TARGET_ID pinned`);
  } else if (path === '/observe') {
    record(path, r.data?.observed === true, r.data?.observed ? `url=${String(r.data.url).slice(0, 40)} elements=${r.data.targets?.length}` : (r.data?.error || 'no observation'));
  } else {
    record(path, r.data?.ok === true, r.data?.ok ? `${r.data.mimeType} captured` : (r.data?.error || 'no capture'));
  }
}

// Mutation endpoints: confirm the gate, never actuate.
for (const [path, payload] of [
  ['/click', { selector: 'x', expectedUrl: 'http://198.51.100.1/' }],
  ['/type', { selector: 'x', text: '', expectedUrl: 'http://198.51.100.1/' }],
]) {
  const r = await call('POST', path, payload);
  const err = r.data?.error;
  const gated = err === 'MUTATIONS_DISABLED' || err === 'EXPECTED_ALLOWED_URL_REQUIRED';
  record(`${path} policy gate`, gated, gated ? err : `ungated: ${JSON.stringify(r.data).slice(0, 80)}`);
}

const failed = results.filter(r => !r.pass);
console.log(`\nRESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'}  (${results.length - failed.length}/${results.length})`);
// Setting exitCode rather than calling process.exit lets pending handles close.
process.exitCode = failed.length === 0 ? 0 : 1;
