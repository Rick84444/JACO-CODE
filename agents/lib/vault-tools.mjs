import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SecretStore } from './secret-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HELPER_SCRIPT = path.join(ROOT, 'agents', 'vault-tool-helper.ps1');
// Outside Windows there is no DPAPI: JACO's encrypted store (secret-store.mjs) is the vault, so the
// agents' sign-up flow (vault-generate-secret, secret-store, vault:<key>) works in the cloud and on Android.
const useStore = () => process.platform !== 'win32';
const store = () => new SecretStore();

/**
 * Dynamically retrieves a secret from Windows Credential Manager (DPAPI) or process memory.
 */
export async function getVaultSecret({ key, prefix = 'JACO' } = {}) {
  if (!key) throw new Error('VAULT_KEY_REQUIRED');
  const cleanKey = String(key).trim();

  // 1. Check process.env first for ultra-fast access
  if (process.env[cleanKey]) {
    return { ok: true, verified: true, key: cleanKey, value: process.env[cleanKey], source: 'env' };
  }

  if (useStore()) {
    let value = null;
    try { value = store().get(cleanKey); } catch (error) { return { ok: false, verified: false, error: error?.message || 'SECRET_STORE_FAILED', key: cleanKey }; }
    if (value) { process.env[cleanKey] = value; return { ok: true, verified: true, key: cleanKey, value, source: 'store' }; }
    return { ok: false, verified: false, error: 'SECRET_NOT_FOUND', key: cleanKey };
  }
  // 2. Query DPAPI vault via PowerShell helper
  const res = await runVaultHelper(['-Action', 'Get', '-Key', cleanKey, '-Prefix', prefix]);
  if (res?.ok && res?.value) {
    // Cache in process environment memory for fast subsequent calls
    process.env[cleanKey] = res.value;
    return { ok: true, verified: true, key: cleanKey, value: res.value, source: 'vault' };
  }
  return { ok: false, verified: false, error: res?.error || 'SECRET_NOT_FOUND', key: cleanKey };
}

/**
 * Dynamically saves a secret into Windows Credential Manager (DPAPI) and process memory.
 */
export async function saveVaultSecret({ key, value, prefix = 'JACO' } = {}) {
  if (!key) throw new Error('VAULT_KEY_REQUIRED');
  if (value === undefined || value === null) throw new Error('VAULT_VALUE_REQUIRED');
  const cleanKey = String(key).trim();
  const valStr = String(value);

  if (useStore()) {
    try { store().set(cleanKey, valStr, { source: 'agent' }); }
    catch (error) { return { ok: false, verified: false, error: error?.message || 'FAILED_TO_SAVE_SECRET', key: cleanKey }; }
    process.env[cleanKey] = valStr;
    return { ok: true, verified: true, key: cleanKey, message: 'Secret saved to the encrypted JACO store', source: 'store' };
  }
  // Persist to DPAPI vault via PowerShell helper
  // Secrets travel over stdin, never argv (which is visible in process listings).
  const res = await runVaultHelper(['-Action', 'Set', '-Key', cleanKey, '-ValueFromStdin', '-Prefix', prefix], 10_000, { input: JSON.stringify({ value: valStr }) });
  if (res?.ok) {
    process.env[cleanKey] = valStr;
    return { ok: true, verified: true, key: cleanKey, message: 'Secret securely saved to DPAPI vault', source: 'vault' };
  }
  return { ok: false, verified: false, error: res?.error || 'FAILED_TO_SAVE_SECRET', key: cleanKey };
}

/**
 * Lists all managed secret key names in the DPAPI vault.
 */
export async function listVaultSecrets({ prefix = 'JACO' } = {}) {
  if (useStore()) {
    const keys = store().list().map(s => s.name);
    return { ok: true, verified: true, prefix, keys, count: keys.length };
  }
  const res = await runVaultHelper(['-Action', 'List', '-Prefix', prefix]);
  if (res?.ok) {
    return { ok: true, verified: true, prefix, keys: res.keys || [], count: res.count || 0 };
  }
  return { ok: false, verified: false, error: res?.error || 'FAILED_TO_LIST_SECRETS' };
}

export function runVaultHelper(args = [], timeoutMs = 10_000, { input = null, spawnFn = spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') {
      return resolve({ ok: false, error: 'VAULT_ONLY_AVAILABLE_ON_WINDOWS' });
    }

    let child;
    try { child = spawnFn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', HELPER_SCRIPT,
      ...args
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }); } catch { return resolve({ ok: false, error: 'VAULT_HELPER_SPAWN_FAILED' }); }

    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, error: 'VAULT_HELPER_TIMEOUT' });
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    // Drain stderr, but never propagate PowerShell diagnostics containing secrets.
    child.stderr?.on('data', () => {});
    const fail = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: code });
    };
    child.once('error', () => fail('VAULT_HELPER_SPAWN_FAILED'));
    child.stdin?.once('error', () => fail('VAULT_HELPER_INPUT_FAILED'));
    child.stdin?.end(input ?? '');

    // close, unlike exit, waits until the output pipes have drained.
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({ ok: false, error: `VAULT_HELPER_EXIT_${code}` });
      }
      try {
        const json = JSON.parse(stdout.trim());
        resolve(json);
      } catch (err) {
        resolve({ ok: false, error: 'VAULT_PARSE_ERROR' });
      }
    });
  });
}
