import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { cliEnv, brainStatus, complete, startLogin, BRAINS } from '../../runtime/src/server/connected/cliBrains.mjs';
import { manualAuraProviderCompletion, auraChatProviderCatalog } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';

// A stand-in for a vendor CLI: records what it was started with and what arrived on stdin.
function fakeCli(handler) {
  const calls = [];
  const spawnImpl = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => {};
    const call = { bin, args, env: opts.env, stdin: '' };
    calls.push(call);
    child.stdin.on('data', d => { call.stdin += d; });
    child.stdin.on('end', () => setImmediate(() => {
      const r = handler(call);
      if (r.stdout) child.stdout.write(r.stdout);
      if (r.stderr) child.stderr.write(r.stderr);
      child.stdout.end(); child.stderr.end();
      setImmediate(() => child.emit('close', r.code ?? 0));
    }));
    return child;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}

const signedIn = JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' });
const signedOut = JSON.stringify({ loggedIn: false });
const claudeCli = ({ status = signedIn, reply = 'hej' } = {}) => fakeCli(c =>
  c.args[0] === 'auth' ? { stdout: status } : { stdout: JSON.stringify({ result: reply, is_error: false }) });

test('the CLI never sees API keys or JACO secrets', () => {
  const env = cliEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x', OPENAI_API_KEY: 'sk-x', GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'g', JACO_WORKPLACE_TOKEN: 't' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('claude status is read from the CLI and a missing CLI is reported as not installed', async () => {
  assert.equal((await brainStatus('claude', { spawnImpl: claudeCli() })).loggedIn, true);
  assert.equal((await brainStatus('claude', { spawnImpl: claudeCli({ status: signedOut }) })).loggedIn, false);
  const missing = () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; };
  const s = await brainStatus('claude', { spawnImpl: missing });
  assert.equal(s.installed, false); assert.equal(s.loggedIn, false);
});

test('unreadable status output fails closed', async () => {
  const s = await brainStatus('claude', { spawnImpl: fakeCli(() => ({ stdout: 'garbage' })) });
  assert.equal(s.loggedIn, false);
});

test('gemini sign-in is the Google credentials file, and its login is a terminal command', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-gem-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-bin-'));
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'gemini.EXE' : 'gemini'), '');
  const env = { PATH: bin, PATHEXT: '.EXE' };
  assert.equal((await brainStatus('gemini', { home, env })).loggedIn, false);
  fs.mkdirSync(path.join(home, '.gemini')); fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}');
  const s = await brainStatus('gemini', { home, env });
  assert.equal(s.installed, true); assert.equal(s.loggedIn, true);
  assert.deepEqual(await startLogin('gemini'), { state: 'TERMINAL', command: 'gemini' });
});

test('a leftover Gemini credentials file does not make an uninstalled CLI signed in', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-gem-'));
  fs.mkdirSync(path.join(home, '.gemini')); fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}');
  const s = await brainStatus('gemini', { home, env: { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-empty-')) } });
  assert.equal(s.installed, false); assert.equal(s.loggedIn, false); assert.equal(s.detail, 'CLI_NOT_INSTALLED');
});

test('a completion sends the prompt on stdin, tool-less, without API keys, and returns the text', async () => {
  const spawnImpl = claudeCli({ reply: 'svar' });
  const r = await complete('claude-cli', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hemlig fråga' }], spawnImpl,
    env: { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-leak' } });
  assert.equal(r.content, 'svar');
  const call = spawnImpl.calls[0];
  assert.ok(call.stdin.includes('hemlig fråga'));
  assert.ok(!call.args.join(' ').includes('hemlig'));
  assert.ok(call.args.includes('--no-session-persistence'));
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
  assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
});

test('a failing, empty or oversized-model completion fails closed and is not retried', async () => {
  const bad = fakeCli(() => ({ code: 1, stderr: 'not logged in' }));
  await assert.rejects(complete('claude-cli', { messages: [{ role: 'user', content: 'x' }], spawnImpl: bad }), /CLI_BRAIN_EXIT_1/);
  assert.equal(bad.calls.length, 1);
  await assert.rejects(complete('claude-cli', { messages: [{ role: 'user', content: 'x' }], spawnImpl: claudeCli({ reply: '  ' }) }), /PROVIDER_EMPTY_COMPLETION/);
  await assert.rejects(complete('claude-cli', { messages: [{ role: 'user', content: 'x' }], model: 'a b; rm -rf /', spawnImpl: claudeCli() }), /CLI_MODEL_INVALID/);
  await assert.rejects(complete('nope', { messages: [{ role: 'user', content: 'x' }] }), /PROVIDER_NOT_FOUND/);
});

test('browser sign-in returns the address the CLI printed, once per CLI', async () => {
  const spawnImpl = (bin, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    spawnImpl.calls.push({ bin, args });
    setImmediate(() => child.stdout.write('Open https://claude.ai/oauth/authorize?code=abc to sign in\n'));
    return child;
  };
  spawnImpl.calls = [];
  const a = await startLogin('claude', { spawnImpl });
  assert.equal(a.state, 'WAITING');
  assert.match(a.url, /^https:\/\/claude\.ai\//);
  assert.deepEqual(spawnImpl.calls[0].args, ['auth', 'login', '--claudeai']);
  const b = await startLogin('claude', { spawnImpl });
  assert.equal(spawnImpl.calls.length, 1);
  assert.equal(b.url, a.url);
});

test('a signed-in CLI is a provider in the one registry: active, chat works, signed-out is not active', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-reg-'));
  let status = signedIn;
  const spawnImpl = fakeCli(c => c.args[0] === 'auth' ? { stdout: status } : { stdout: JSON.stringify({ result: 'ok' }) });
  const reg = new ProviderRegistry(root, { PATH: '/bin' }, { cli: { spawnImpl } });
  const p = reg.registerCliBrain('claude');
  assert.equal(p.id, 'claude-cli'); assert.equal(p.kind, 'cli-login'); assert.equal(p.credentialConfigured, true);
  let scan = (await reg.scan()).find(x => x.id === 'claude-cli');
  assert.equal(scan.active, true); assert.equal(scan.state, 'ACTIVE');
  const chat = await reg.chat({ providerId: 'claude-cli', messages: [{ role: 'user', content: 'hej' }] });
  assert.equal(chat.content, 'ok');
  status = signedOut;
  scan = (await reg.scan()).find(x => x.id === 'claude-cli');
  assert.equal(scan.active, false); assert.equal(scan.state, 'NO_KEY');
  // It survives a restart.
  const again = new ProviderRegistry(root, { PATH: '/bin' }, { cli: { spawnImpl } });
  assert.equal(again.providers.get('claude-cli').kind, 'cli-login');
});

test('every brand has a distinct provider id that the registry id syntax accepts', () => {
  const ids = Object.values(BRAINS).map(b => b.providerId);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9._-]{1,63}$/);
});

test('Aura chat through a subscription brain skips metered-cloud authorization and reports SUBSCRIPTION', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-aura-'));
  const spawnImpl = fakeCli(c => c.args[0] === 'auth' ? { stdout: signedIn } : { stdout: JSON.stringify({ result: 'hej från abonnemanget' }) });
  const reg = new ProviderRegistry(root, { PATH: '/bin' }, { cli: { spawnImpl } });
  reg.registerCliBrain('claude');
  const entry = auraChatProviderCatalog(reg, {}).find(p => p.id === 'claude-cli');
  assert.equal(entry.subscription, true); assert.equal(entry.credentialReady, true); assert.equal(entry.local, false);
  // Cloud spending is switched off: any metered path would throw. The subscription path must not touch it.
  const economic = new Proxy({}, { get: (_t, name) => () => { throw new Error(`metered path used: ${String(name)}`); } });
  const r = await manualAuraProviderCompletion({ providerId: 'claude-cli', model: 'default', system: 'S', user: 'U' }, { providers: reg, economic, env: {} });
  assert.equal(r.text, 'hej från abonnemanget'); assert.equal(r.costStatus, 'SUBSCRIPTION'); assert.equal(r.local, false);
});
