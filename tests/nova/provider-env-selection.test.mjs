import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';

test('built-in provider follows changed environment across registry restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-provider-env-'));
  try {
    const first = new ProviderRegistry(root, { OLLAMA_MODEL: 'first-model', OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1' });
    assert.equal(first.providers.get('ollama').defaultModel, 'first-model');
    const second = new ProviderRegistry(root, { OLLAMA_MODEL: 'second-model', OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1' });
    assert.equal(second.providers.get('ollama').defaultModel, 'second-model');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.jaco/runtime/providers.json'), 'utf8')).find(p => p.id === 'ollama').defaultModel, 'second-model');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
