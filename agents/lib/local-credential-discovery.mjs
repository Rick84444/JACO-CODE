// Reuse the current runtime's environment and known JACO .env files. Never enumerate
// home directories, return secret values, write files, or contact external services here.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { CATALOG } from '../../runtime/src/server/connected/providerCatalog.mjs';

export const LOCAL_SERVICE_KEYS = Object.freeze([...new Set([
  ...CATALOG.map(service => service.apiKeyEnv),
  'CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'COINBASE_COMMERCE_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'SKYFIRE_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_DEPLOY_API_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'HF_TOKEN',
])]);

const APPROVED = new Set(LOCAL_SERVICE_KEYS);

export function jacoEnvRoot(cwd = process.cwd(), fsImpl = fs) {
  const here = path.resolve(cwd);
  for (const candidate of [here, path.dirname(here)]) {
    if (fsImpl.existsSync(path.join(candidate, 'runtime', 'server.ts')) &&
        fsImpl.existsSync(path.join(candidate, 'agents', 'lib', 'secret-store.mjs'))) return candidate;
  }
  return null;
}

export function loadLocalJacoEnv({ cwd = process.cwd(), env = process.env, fsImpl = fs } = {}) {
  const root = jacoEnvRoot(cwd, fsImpl);
  const observedFiles = [], loaded = [];
  if (!root) return { rootFound: false, observedFiles, loaded };
  // Strictly JACO-owned files: never recursively scan a project, home directory or remote mount.
  for (const relative of ['.env', '.env.local', 'runtime/.env', 'runtime/.env.local']) {
    const filename = path.join(root, relative);
    try {
      const stat = fsImpl.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) continue;
      const source = parse(fsImpl.readFileSync(filename, 'utf8'));
      observedFiles.push(relative);
      for (const [name, value] of Object.entries(source)) {
        if (!APPROVED.has(name) || env[name] || typeof value !== 'string' || !value.trim()) continue;
        env[name] = value.trim(); // Runtime-only; no migration, write-back or log of values.
        loaded.push({ name, source: relative });
      }
    } catch (error) { if (error?.code !== 'ENOENT') continue; }
  }
  return { rootFound: true, observedFiles, loaded };
}

// Windows Credential Manager's JACO namespace is a legacy credential source.
// Only recognised model provider keys are read automatically for safe /models discovery.
// Payments, trading, cloud deploy or account mutations are NEVER attempted by this helper.
/** @param {{ env?: Record<string, string | undefined>, list?: (() => Promise<{ok?: boolean, keys?: string[]}>), read?: ((name: string) => Promise<{ok?: boolean, value?: string}>) }} [options] */
export async function loadWindowsModelKeys({ env = process.env, list, read } = {}) {
  if (typeof list !== 'function' || typeof read !== 'function') return { sourceAvailable: false, configured: [] };
  const configured = [];
  let found;
  try { found = await list(); } catch { return { sourceAvailable: false, configured }; }
  if (!found?.ok) return { sourceAvailable: false, configured };
  const allowed = new Set(CATALOG.map(item => item.apiKeyEnv));
  const present = [...new Set(found.keys || [])].filter(key => allowed.has(key) && !env[key]).slice(0, 25);
  for (const name of present) {
    try {
      const result = await read(name);
      if (result?.ok && typeof result.value === 'string' && result.value) {
        env[name] = result.value;
        configured.push(name);
      }
    } catch { /* missing/locked DPAPI key fails closed */ }
  }
  return { sourceAvailable: true, configured };
}
