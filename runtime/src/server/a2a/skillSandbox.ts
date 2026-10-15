import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

/**
 * Isolated execution for A2A skill code.
 *
 * Replaces the archived prototype's `new Function(code)(params, require)` call,
 * which ran peer-authored JavaScript inside the JACO server process with full
 * access to `process`, `globalThis`, `fetch` and the module loader. Any peer
 * that could publish a skill could read `process.env` and every credential in it.
 *
 * What this module actually guarantees:
 *  - the code runs on a separate worker thread, never on the request thread;
 *  - it runs inside a fresh `vm` context whose global object has no `require`,
 *    no `process`, no `fetch`, no timers and no host references;
 *  - parameters cross the boundary as a JSON string parsed inside the context,
 *    so the guest never receives a host object it could walk back to a realm;
 *  - wall-clock timeout, heap ceiling and output size are enforced, and the
 *    worker is terminated on breach;
 *  - the result is re-serialised through JSON before it re-enters the server.
 *
 * What it does NOT guarantee: `vm` is not a security boundary of last resort.
 * A dedicated attacker with a V8 escape can still leave the context. Skills from
 * peers therefore stay `UNVERIFIED` and non-executable until an operator promotes
 * them (see skillRegistry.ts), and OS-level isolation remains the right control
 * for genuinely untrusted code. This module is stated as defence in depth, not
 * as a claim of perfect containment.
 */

export interface SandboxLimits {
  timeoutMs: number;
  maxHeapMb: number;
  maxOutputBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  timeoutMs: 5_000,
  maxHeapMb: 64,
  maxOutputBytes: 256_000,
};

export interface SandboxOutcome {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTimeMs: number;
  checksum: string;
  limits: SandboxLimits;
  terminatedByLimit: boolean;
  staticFindings: string[];
}

/**
 * Patterns that indicate an attempt to reach the host realm. Not a sandbox in
 * itself — a determined author can obfuscate around any pattern list — but a
 * cheap, auditable signal recorded on the receipt before execution.
 */
const ESCAPE_INDICATORS: Array<{ pattern: RegExp; finding: string }> = [
  { pattern: /\bprocess\b/, finding: 'references process' },
  { pattern: /\brequire\s*\(/, finding: 'calls require()' },
  { pattern: /\bimport\s*\(/, finding: 'uses dynamic import()' },
  { pattern: /\bglobalThis\b/, finding: 'references globalThis' },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, finding: 'uses constructor.constructor realm walk' },
  { pattern: /\b__proto__\b/, finding: 'mutates __proto__' },
  { pattern: /\bBuffer\b/, finding: 'references Buffer' },
  { pattern: /\bfetch\s*\(/, finding: 'attempts network access' },
  { pattern: /\beval\s*\(/, finding: 'calls eval()' },
  { pattern: /\bWebAssembly\b/, finding: 'references WebAssembly' },
];

export function analyseSkillSource(code: string): string[] {
  return ESCAPE_INDICATORS.filter(({ pattern }) => pattern.test(code)).map(({ finding }) => finding);
}

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Worker bootstrap. Evaluated as CommonJS on its own thread so the bundle stays
 * a single file — esbuild does not need to resolve a second entry point.
 */
const WORKER_SOURCE = `
'use strict';
const vm = require('node:vm');
const { parentPort, workerData } = require('node:worker_threads');

function reply(message) {
  try { parentPort.postMessage(message); } catch (error) {
    parentPort.postMessage({ ok: false, error: 'result is not structured-cloneable: ' + String(error && error.message) });
  }
}

(async () => {
  const started = Date.now();
  try {
    // Fresh realm. The global object starts empty; only ECMAScript intrinsics
    // are attached by createContext. No require, process, timers or network.
    const context = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });

    // Primitive strings only. Nothing here is a host object reference.
    context.__jacoParamsJson = String(workerData.paramsJson);

    const program = [
      '"use strict";',
      '(function () {',
      '  const params = JSON.parse(__jacoParamsJson);',
      '  ' + workerData.code,
      '  if (typeof handler === "function") return handler(params);',
      '  if (typeof run === "function") return run(params);',
      '  throw new Error("skill must define handler(params) or run(params)");',
      '})()',
    ].join('\\n');

    let value = vm.runInContext(program, context, {
      timeout: workerData.timeoutMs,
      displayErrors: true,
      breakOnSigint: true,
    });

    // Guest promises resolve on microtasks only; the parent hard timeout is the
    // real bound. This keeps a returned thenable from leaking out unresolved.
    if (value && typeof value.then === 'function') value = await value;

    const serialised = JSON.stringify(value === undefined ? null : value);
    if (serialised === undefined) throw new Error('skill returned a value that is not JSON-serialisable');
    if (Buffer.byteLength(serialised, 'utf8') > workerData.maxOutputBytes) {
      throw new Error('skill output exceeds ' + workerData.maxOutputBytes + ' byte limit');
    }

    reply({ ok: true, serialised, executionTimeMs: Date.now() - started });
  } catch (error) {
    reply({ ok: false, error: String((error && error.message) || error), executionTimeMs: Date.now() - started });
  }
})();
`;

export async function runSkillInSandbox(
  code: string,
  params: unknown,
  limits: Partial<SandboxLimits> = {},
): Promise<SandboxOutcome> {
  const effective: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...limits };
  const staticFindings = analyseSkillSource(code);
  const started = Date.now();

  let paramsJson: string;
  try {
    paramsJson = JSON.stringify(params ?? {});
    if (typeof paramsJson !== 'string') throw new Error('parameters are not JSON-serialisable');
  } catch (error) {
    return {
      success: false,
      error: `parameters rejected: ${error instanceof Error ? error.message : String(error)}`,
      executionTimeMs: 0,
      checksum: '',
      limits: effective,
      terminatedByLimit: false,
      staticFindings,
    };
  }

  return new Promise<SandboxOutcome>((resolve) => {
    let settled = false;
    let terminatedByLimit = false;

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        code,
        paramsJson,
        timeoutMs: effective.timeoutMs,
        maxOutputBytes: effective.maxOutputBytes,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: effective.maxHeapMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.floor(effective.maxHeapMb / 4)),
      },
      // The guest gets no ambient environment and no inherited stdio.
      env: {},
      argv: [],
      stdin: false,
      stdout: true,
      stderr: true,
    });

    const finish = (outcome: Omit<SandboxOutcome, 'limits' | 'staticFindings' | 'terminatedByLimit'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      void worker.terminate();
      resolve({ ...outcome, limits: effective, terminatedByLimit, staticFindings });
    };

    // Wall clock is enforced here, not inside the guest: vm's own timeout does
    // not cover microtask loops or a wedged async continuation.
    const hardTimer = setTimeout(() => {
      terminatedByLimit = true;
      finish({
        success: false,
        error: `skill exceeded ${effective.timeoutMs} ms wall-clock limit and was terminated`,
        executionTimeMs: Date.now() - started,
        checksum: '',
      });
    }, effective.timeoutMs + 500);

    worker.on('message', (message: { ok: boolean; serialised?: string; error?: string; executionTimeMs?: number }) => {
      if (message?.ok && typeof message.serialised === 'string') {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(message.serialised);
        } catch {
          finish({
            success: false,
            error: 'skill output failed re-parse after serialisation',
            executionTimeMs: message.executionTimeMs ?? Date.now() - started,
            checksum: '',
          });
          return;
        }
        finish({
          success: true,
          result: parsed,
          executionTimeMs: message.executionTimeMs ?? Date.now() - started,
          checksum: sha256Hex(message.serialised),
        });
        return;
      }
      finish({
        success: false,
        error: message?.error || 'skill execution failed without a reason',
        executionTimeMs: message?.executionTimeMs ?? Date.now() - started,
        checksum: '',
      });
    });

    worker.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/heap out of memory|Worker terminated due to reaching memory limit/i.test(message)) terminatedByLimit = true;
      finish({ success: false, error: message, executionTimeMs: Date.now() - started, checksum: '' });
    });

    worker.on('exit', (exitCode) => {
      finish({
        success: false,
        error: `skill worker exited with code ${exitCode} before returning a result`,
        executionTimeMs: Date.now() - started,
        checksum: '',
      });
    });
  });
}
