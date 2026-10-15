import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import { importProviderEnv, providerEnvFiles } from '../../agents/lib/provider-env-import.mjs';
test('selected env import keeps values out of receipts, ignores unrelated secrets and preserves existing keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-env-'));
  try {
    const marker = 'fixture-provider-value-never-return';
    fs.writeFileSync(path.join(dir, '.env'), 'OPENAI_API_KEY=' + marker + '\nGITHUB_TOKEN=fixture-unrelated-value\n');
    const stored = new Map(); const store = { has: k => stored.has(k), set: (k,v) => stored.set(k,v) };
    assert.deepEqual(providerEnvFiles(dir), ['.env']);
    assert.throws(() => importProviderEnv({ project: dir, file: '.env', store }), /CONFIRMATION_REQUIRED/);
    assert.throws(() => importProviderEnv({ project: dir, file: '../.env', confirmed: true, store }), /FILE_NOT_ALLOWED/);
    const result = importProviderEnv({ project: dir, file: '.env', confirmed: true, store });
    assert.deepEqual(result.imported, ['openai']); assert.equal(stored.get('OPENAI_API_KEY'), marker);
    assert.equal(stored.has('GITHUB_TOKEN'), false); assert.equal(JSON.stringify(result).includes(marker), false);
    assert.deepEqual(importProviderEnv({ project: dir, file: '.env', confirmed: true, store }).kept, ['openai']);
    fs.writeFileSync(path.join(dir, '.env.large'), 'x'.repeat(129 * 1024));
    assert.throws(() => importProviderEnv({ project: dir, file: '.env.large', confirmed: true, store }), /TOO_LARGE/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
