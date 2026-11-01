#!/usr/bin/env node
// Real unpacked-runtime acceptance: first start, negative consent/auth checks,
// saved preferences, exact-child restart, local HTTP identity and shutdown.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function verifyProductSetup(stage) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-product-setup-'));
  const project = path.join(temporary, 'workspace'); fs.mkdirSync(project);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const env = { ...process.env, JACO_REQUIRE_SETUP: '1', JACO_STATE_DIR: path.join(temporary, 'credentials'),
    JACO_LITE_NO_UPDATE_CHECK: '1', JACO_ENABLE_CDP: '0' };
  for (const name of Object.keys(env)) if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(name)) delete env[name];
  const child = spawn(process.execPath, [path.join(stage, 'start.mjs'), project, '--no-open', '--port', String(port)], { env, cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', stopped = false, exit;
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-16000); });
  const finished = new Promise(resolve => { child.once('exit', (code, signal) => { stopped = true; exit = { code, signal }; resolve(exit); }); child.once('error', error => { stopped = true; resolve({ error: error.message }); }); });
  const waitFor = async predicate => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !stopped) {
      try { if (await predicate()) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error('PRODUCT_SETUP_TIMEOUT: ' + JSON.stringify(exit) + '\n' + output);
  };
  const json = async (route, body, extraHeaders = {}) => {
    const response = await fetch(base + route, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { 'content-type': 'application/json', ...extraHeaders }, signal: AbortSignal.timeout(3000) });
    return { response, body: await response.json() };
  };
  const expect = (value, message) => { if (!value) throw Error(message); };
  try {
    await waitFor(async () => { const result = await json('/api/runtime/identity'); return result.body.success === true && result.body.product === 'JACO Autonomus IDE' && result.body.setupPending === true; });
    const redirect = await fetch(base, { redirect: 'manual' });
    expect(redirect.status === 302 && redirect.headers.get('location') === '/connect.html', 'FIRST_RUN_NOT_GUIDED');
    const blocked = await json('/api/aura/workbench/providers/scan');
    expect(blocked.response.status === 409 && blocked.body.error === 'SETUP_REQUIRED', 'PRECONSENT_MODEL_ACCESS_NOT_BLOCKED');
    const choices = { confirmed: true, language: 'en', discoverLocal: false, connectTools: false, runAgent: false, cloudModels: false };
    const noConsent = await json('/api/aura/workbench/setup/complete', { ...choices, confirmed: false });
    expect(noConsent.response.status === 409, 'MISSING_SETUP_CONSENT_ACCEPTED');
    const crossOrigin = await json('/api/aura/workbench/setup/complete', choices, { origin: 'https://untrusted.example' });
    expect(crossOrigin.response.status === 401 || crossOrigin.response.status === 403, 'CROSS_ORIGIN_SETUP_ACCEPTED');
    const relayed = await json('/api/aura/workbench/setup/complete', choices, { 'x-forwarded-for': '203.0.113.5' });
    expect(relayed.response.status === 401 || relayed.response.status === 403, 'REMOTE_SETUP_ACCEPTED');
    const completed = await json('/api/aura/workbench/setup/complete', choices);
    expect(completed.body.success === true && completed.body.restartRequired === true, 'SETUP_NOT_SAVED');
    await waitFor(async () => { const result = await json('/api/runtime/identity'); return result.body.success === true && result.body.setupPending === false; });
    await waitFor(() => fs.readFileSync(path.join(project, '.jaco', 'lite-lifecycle.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
      .filter(row => row.component === 'ide' && row.event === 'READY').length >= 2);
    const receipt = JSON.parse(fs.readFileSync(path.join(project, '.jaco', 'installation.json'), 'utf8'));
    expect(receipt.cloudModels === false && receipt.runAgent === false, 'SETUP_CHOICES_LOST');
    const budget = JSON.parse(fs.readFileSync(path.join(project, '.jaco', 'continuum', 'economic-policy.json'), 'utf8'));
    expect(budget.cloudEnabled === false, 'CLOUD_ENABLED_WITHOUT_APPROVAL');
    const lifecycle = fs.readFileSync(path.join(project, '.jaco', 'lite-lifecycle.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(lifecycle.filter(row => row.component === 'ide' && row.event === 'READY').length === 2, 'SETUP_RESTART_NOT_OBSERVED');
    expect(!lifecycle.some(row => row.component === 'agent'), 'AGENT_STARTED_WHEN_DISABLED');
    const page = await fetch(base + '/connect.html');
    expect((await page.text()).includes('<html lang="en">'), 'SETUP_NOT_ENGLISH_BY_DEFAULT');
    child.kill('SIGTERM');
    const result = await Promise.race([finished, new Promise(resolve => setTimeout(() => resolve(null), 10000))]);
    expect(result && result.code === 0, 'PRODUCT_SHUTDOWN_NOT_CONFIRMED');
    return { schema: 'jaco.product-setup-verification/v1', firstStart: true, consentRequired: true, remoteSetupDenied: true, preferencesPersisted: true, restartObserved: true, cloudDisabled: true, agentDisabled: true, shutdownConfirmed: true };
  } finally {
    if (!stopped) child.kill('SIGTERM');
    await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 10000))]);
    if (stopped) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyProductSetup(path.resolve(process.argv[2] || 'build/lite/stage/jaco-lite-0.22.0')).then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
}
