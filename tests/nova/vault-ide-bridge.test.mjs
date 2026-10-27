import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecretStore, isExportableSecret, hydrateEnvFromStore } from '../../agents/lib/secret-store.mjs';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

test('Vault uses the existing encrypted SecretStore, not the old in-memory AuraEngine list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ide-vault-'));
  try {
    const env = { JACO_STATE_DIR: dir };
    const store = new SecretStore({ env, dir });
    const raw = 'do-not-show-this-secret-value';
    store.set('CDP_API_KEY_SECRET', raw, { source: 'operator' });
    const listing = store.list();
    assert.deepEqual(listing.map(x => x.name), ['CDP_API_KEY_SECRET']);
    assert.ok(!JSON.stringify(listing).includes(raw));
    const bytes = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
    assert.ok(!bytes.includes(raw), 'plaintext may not be persisted');
    assert.equal(store.get('CDP_API_KEY_SECRET'), raw, 'secret usable internally');
    const env2 = { JACO_STATE_DIR: dir };
    assert.ok(hydrateEnvFromStore(env2, store).includes('CDP_API_KEY_SECRET'));
    assert.equal(env2.CDP_API_KEY_SECRET, raw);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Coinbase CDP key ID is rehydrated but NOVA-managed secrets stay private', () => {
  assert.equal(isExportableSecret('CDP_API_KEY_ID'), true);
  assert.equal(isExportableSecret('CDP_API_KEY_SECRET'), true);
  assert.equal(isExportableSecret('NOVA_EXAMPLE_API_KEY'), false);
  assert.equal(isExportableSecret('NOVA_EXAMPLE_PASSWORD'), false);
});

test('canonical Aura Connections tab embeds persistent API Vault', () => {
  const workspace = read('runtime/src/components/ConnectionsWorkspace.tsx');
  const panel = read('runtime/src/components/ApiVaultPanel.tsx');
  assert.match(workspace, /\['vault','API & Vault'\]/);
  assert.match(workspace, /tab==='vault'&&<ApiVaultPanel/);
  assert.match(panel, /\/api\/aura\/workbench\/secrets/);
  assert.match(panel, /\/api\/aura\/workbench\/vault\/windows/);
  assert.match(panel, /\/api\/aura\/workbench\/vault\/import-windows/);
  assert.doesNotMatch(panel, /fetch\(['"]\/api\/vault['"]/);
  assert.match(panel, /Coinbase CDP/);
  assert.match(panel, /Inte API-verifierad/);
  assert.match(panel, /secrets\?\.some\(secret => secret.name === key\)/);
});

test('Windows Vault bridge is read-only by default and imports only an operator-chosen key', () => {
  const src = read('runtime/server.ts');
  const start = src.indexOf("app.get('/api/aura/workbench/vault/windows'");
  const end = src.indexOf("app.post('/api/aura/workbench/providers/connect'", start);
  assert.ok(start > 0 && end > start);
  const routes = src.slice(start,end);
  assert.match(routes, /requireLocalUi/);
  assert.match(routes, /listVaultSecrets\(\{ prefix: 'JACO' \}\)/);
  assert.match(routes, /validateSecretName\(req.body\?\.name\)/);
  assert.match(routes, /store.has\(name\)/);
  assert.match(routes, /listed.keys\?\.includes\(name\)/);
  assert.match(routes, /runVaultHelper\(\['-Action', 'Get', '-Key', name, '-Prefix', 'JACO'\]\)/);
  assert.match(routes, /store.set\(name, retrieved.value/);
  assert.doesNotMatch(routes, /'Delete'|'Set'|deleteVaultItem/);
  assert.match(routes, /if \(process\.platform !== 'win32'\)/);
  assert.match(routes, /receipt: \{ name, source: 'windows-credential-manager', valueExposed: false \}/);
  assert.match(src, /app.delete\("\/api\/vault\/:id", requireOperator/);
});

test('the Windows credential importer does not return secret values to Aura', () => {
  const src = read('runtime/server.ts');
  const route = src.slice(src.indexOf("app.post('/api/aura/workbench/vault/import-windows'"), src.indexOf("app.post('/api/aura/workbench/providers/connect'"));
  assert.match(route, /res.status\(201\).json\(\{ success: true, secret \}\)/);
  assert.match(route, /SecretStore\(\)/);
  assert.doesNotMatch(route, /res\.(?:json|send)\([^\n]*retrieved\.value/);
  assert.match(route, /connectedRuntime.providers.ensureDefaults\(\)/);
});
