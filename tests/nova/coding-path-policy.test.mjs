import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathAllowed, matchesContractPath, normalizeCodingContract, validateCodingTask } from '../../agents/lib/coding-contract.mjs';

const rawContract = { scope: { allowed: ['**'], forbidden: [] } };

test('mandatory exclusions protect root, nested and differently cased names in raw contracts', () => {
  for (const file of ['.git', '.GIT/config', 'nested/.git', 'nested/.GiT/config', '.ENV', '.Env.local', 'nested/.ENV.production', 'secrets.json', 'CREDENTIALS.json', 'src/SecretStore/key.json', 'src/credentials/key', 'NODE_MODULES/x.js', 'src/Node_Modules/x.js']) {
    assert.equal(isPathAllowed(rawContract, file), false, file);
  }
});

test('Windows aliases, devices and alternate streams are rejected before scope matching', () => {
  for (const file of ['C:relative.txt', 'C:/absolute.txt', '\\\\server\\share', '//?/C:/x', 'src/file.txt:stream', 'src/file::$DATA', 'src/.git./config', 'src/.env /key', 'src/trailing.', 'src/trailing ', ' src/file', 'src/NUL', 'src/con.txt', 'src/COM1.log', 'src/lpt².txt', 'src/a\u0000b', 'src/a\nb', 'src/a?b', 'src/a|b', '../outside.txt']) {
    assert.throws(() => isPathAllowed(rawContract, file), /CONTRACT_PATH_/, file);
    assert.throws(() => validateCodingTask({ type: 'repo-read', data: { path: file } }, rawContract), /CONTRACT_PATH_/, file);
  }
});

test('normalization cannot admit ambiguous allow or deny patterns', () => {
  for (const pattern of ['src./**', 'src /file', 'C:relative/**', 'src/file:stream']) {
    for (const field of ['allowed', 'forbidden']) {
      assert.throws(() => normalizeCodingContract({ objective: 'Edit source', scope: { allowed: ['src/**'], [field]: [pattern] }, acceptance: ['Tests pass'] }), /CONTRACT_PATH_/);
    }
  }
});

test('valid narrow scopes, separators and recursive globs preserve intended access', () => {
  const contract = normalizeCodingContract({ objective: 'Edit source', scope: { allowed: ['src/**', 'tests/**/*.test.mjs'], forbidden: ['src/private/**'] }, acceptance: ['Tests pass'] });
  for (const file of ['src', './src/main.mjs', 'src\\nested\\main.mjs', 'src/normal file.mjs', 'tests/main.test.mjs', 'tests/nested/main.test.mjs']) {
    assert.equal(isPathAllowed(contract, file), true, file);
  }
  for (const file of ['README.md', 'source/main.mjs', 'tests/main.mjs', 'src/private/file.mjs', 'src/PRIVATE/file.mjs']) {
    assert.equal(isPathAllowed(contract, file), false, file);
  }
  assert.equal(matchesContractPath('src/*.mjs', 'src/nested/main.mjs'), false);
  assert.equal(matchesContractPath('src/**', 'SRC/main.mjs', true), true);
  assert.equal(matchesContractPath('src/**', 'SRC/main.mjs', false), false);
});
