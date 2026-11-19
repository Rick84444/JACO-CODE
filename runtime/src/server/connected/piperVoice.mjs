// Aura's local voice: Piper TTS with Alma (sv_SE-alma-medium, CC-BY-4.0), kept loaded in one Python worker
// (tools/piper-voice-worker.py). Loading the model costs about nine seconds, so it happens once, not per sentence.
// Requests are serialized; a crashed or hung worker is replaced on the next request.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const defaultPiperModel = (env = process.env) => env.JACO_PIPER_MODEL || path.join(os.homedir(), '.jaco', 'voice', 'piper', 'sv_SE-alma-medium.onnx');

/** @param {{workerScript?: string, env?: Record<string, string|undefined>, spawnImpl?: any, startTimeoutMs?: number, requestTimeoutMs?: number}} [options] */
export function createPiperVoice({ workerScript, env = process.env, spawnImpl = spawn, startTimeoutMs = 60_000, requestTimeoutMs = 60_000 } = {}) {
  const model = defaultPiperModel(env);
  let child = null, ready = null, pending = new Map(), queue = Promise.resolve(), seq = 0;

  const stop = reason => {
    const dying = child; child = null; ready = null;
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending = new Map();
    try { dying?.kill(); } catch {}
  };

  const start = () => {
    if (ready) return ready;
    if (!fs.existsSync(model)) return Promise.reject(new Error('PIPER_MODEL_MISSING'));
    if (!workerScript || !fs.existsSync(workerScript)) return Promise.reject(new Error('PIPER_WORKER_MISSING'));
    const python = env.JACO_VOICE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const proc = spawnImpl(python, ['-I', workerScript, model], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child = proc;
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('PIPER_START_TIMEOUT')); stop('PIPER_START_TIMEOUT'); }, startTimeoutMs);
      pending.set('ready', { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const waiter = pending.get(String(message.id));
      if (!waiter) return;
      pending.delete(String(message.id));
      message.ok ? waiter.resolve() : waiter.reject(new Error(`PIPER_FAILED:${message.error || 'UNKNOWN'}`));
    });
    proc.on('error', () => { if (child === proc) stop('PIPER_SPAWN_FAILED'); });
    proc.on('exit', code => { if (child === proc) stop(`PIPER_EXIT_${code}`); });
    ready.catch(() => {});
    return ready;
  };

  const synthesizeOnce = async text => {
    await start();
    const id = `r${++seq}`;
    const out = path.join(os.tmpdir(), `jaco-aura-voice-${process.pid}-${id}-${Date.now()}.wav`);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('PIPER_TIMEOUT')); stop('PIPER_TIMEOUT'); }, requestTimeoutMs);
        pending.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
        child.stdin.write(JSON.stringify({ id, text: String(text).slice(0, 6000), out }) + '\n');
      });
      const bytes = fs.readFileSync(out);
      if (bytes.length <= 200) throw new Error('PIPER_EMPTY_OUTPUT');
      return bytes;
    } finally { fs.rmSync(out, { force: true }); }
  };

  return {
    model,
    available: () => fs.existsSync(model) && Boolean(workerScript && fs.existsSync(workerScript)),
    // Load the model ahead of the first reply so Aura's first sentence is not nine seconds late.
    warm: () => start().catch(() => {}),
    synthesize(text) {
      const run = queue.then(() => synthesizeOnce(text));
      queue = run.catch(() => {});
      return run;
    },
    stop: () => stop('PIPER_STOPPED'),
  };
}
