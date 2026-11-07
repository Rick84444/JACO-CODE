import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createZip } from '../../tools/lib/zip.mjs';
import { windowsNode } from '../../tools/lib/node-runtime.mjs';

const fakeDist = () => {
  const zip = createZip([{ name: 'node-v24.9.0-win-x64/node.exe', data: Buffer.from('MZ fake node') }, { name: 'node-v24.9.0-win-x64/LICENSE', data: Buffer.from('MIT') }]);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  return { zip, sha, fetchImpl: async url => url.endsWith('SHASUMS256.txt')
    ? { ok: true, text: async () => `${sha}  node-v24.9.0-win-x64.zip\nabc  node-v24.9.0-linux-x64.tar.xz\n` }
    : { ok: true, arrayBuffer: async () => zip } };
};

test('the Windows download gets node.exe from the checked official archive, and uses its cache next time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-cache-'));
  try {
    const { fetchImpl } = fakeDist();
    const first = await windowsNode({ cacheDir: dir, distUrl: 'https://x', fetchImpl });
    assert.equal(first.version, 'v24.9.0');
    assert.equal(first.exe.toString(), 'MZ fake node');
    assert.equal(first.licence.toString(), 'MIT');
    let downloads = 0;
    const again = await windowsNode({ cacheDir: dir, distUrl: 'https://x', fetchImpl: async url => { if (!url.endsWith('.txt')) downloads++; return fetchImpl(url); } });
    assert.equal(again.version, 'v24.9.0');
    assert.equal(downloads, 0, 'the cached archive is used');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an archive that does not match the published checksum is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-cache-'));
  try {
    const { sha } = fakeDist();
    const fetchImpl = async url => url.endsWith('.txt') ? { ok: true, text: async () => `${sha}  node-v24.9.0-win-x64.zip\n` } : { ok: true, arrayBuffer: async () => Buffer.from('tampered') };
    await assert.rejects(windowsNode({ cacheDir: dir, distUrl: 'https://x', fetchImpl }), /NODE_CHECKSUM_MISMATCH/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('START.cmd prefers the bundled node.exe and falls back to an installed Node.js', () => {
  const cmd = fs.readFileSync(new URL('../../lite/START.cmd', import.meta.url), 'utf8');
  assert.ok(cmd.includes(String.raw`set "JACO_NODE=%~dp0node\node.exe"`));
  assert.ok(cmd.includes('"%JACO_NODE%" "%~dp0start.mjs"'));
  assert.match(cmd, /where node/);
});
