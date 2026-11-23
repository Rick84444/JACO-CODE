import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { speechParts } from '../../runtime/src/lib/speechParts.mjs';
import { createPiperVoice } from '../../runtime/src/server/connected/piperVoice.mjs';

test('replies are spoken sentence by sentence with a short first part', () => {
  assert.deepEqual(speechParts(''), []);
  assert.deepEqual(speechParts('Hej. Jag är Aura.'), ['Hej. Jag är Aura.']);
  const long = 'Det här är en mening som är ganska lång och fortsätter en stund. '.repeat(8);
  const parts = speechParts(long);
  assert.ok(parts.length > 2);
  assert.ok(parts[0].length <= 140, 'speech starts after a short first part');
  assert.ok(parts.every(p => p.length <= 220));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '), 'nothing is dropped');
  assert.deepEqual(speechParts('**Klart** `kod` här.'), ['Klart kod här.'], 'markup is not read aloud');
});

function fakeWorker(calls) {
  return (cmd, args) => {
    calls.push({ cmd, args });
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stdin = new PassThrough();
    proc.kill = () => {};
    setImmediate(() => proc.stdout.write(JSON.stringify({ id: 'ready', ok: true }) + '\n'));
    proc.stdin.on('data', chunk => {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        const request = JSON.parse(line);
        fs.writeFileSync(request.out, Buffer.alloc(1000, 1));
        proc.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\n');
      }
    });
    return proc;
  };
}

test('the Alma model is loaded once by one worker and serves every sentence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-piper-'));
  const model = path.join(dir, 'sv_SE-alma-medium.onnx'), worker = path.join(dir, 'worker.py');
  fs.writeFileSync(model, ''); fs.writeFileSync(worker, '');
  const calls = [];
  const voice = createPiperVoice({ workerScript: worker, env: { JACO_PIPER_MODEL: model }, spawnImpl: fakeWorker(calls) });
  const [a, b] = await Promise.all([voice.synthesize('Hej.'), voice.synthesize('Jag är Aura.')]);
  assert.equal(a.length, 1000); assert.equal(b.length, 1000);
  assert.equal(calls.length, 1, 'one process, the model loads once');
  assert.deepEqual(calls[0].args.slice(1), [worker, model]);
  assert.equal(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`jaco-aura-voice-${process.pid}-`)).length, 0, 'temporary audio is removed');
  await assert.rejects(createPiperVoice({ workerScript: worker, env: { JACO_PIPER_MODEL: path.join(dir, 'missing.onnx') } }).synthesize('x'), /PIPER_MODEL_MISSING/);
});
