import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(ROOT, 'agents', 'windows-wmi-read.ps1');

export const WINDOWS_WMI_QUERIES = Object.freeze([
  'system','computer','cpu','memory','disks','network','processes','services'
]);

export function normalizeWmiRequest(input = {}) {
  const query = String(input.query || '').trim().toLowerCase();
  if (!WINDOWS_WMI_QUERIES.includes(query)) throw new Error('WINDOWS_WMI_QUERY_UNSUPPORTED');
  const limit = Math.max(1, Math.min(200, Number(input.limit || 100) || 100));
  return { query, limit };
}

export async function windowsWmiRead(input = {}, {
  platform = process.platform,
  spawnImpl = nodeSpawn,
  scriptPath = SCRIPT,
  timeoutMs = 20_000
} = {}) {
  if (platform !== 'win32') {
    return { ok: false, verified: false, error: 'WINDOWS_WMI_UNAVAILABLE_ON_THIS_HOST', outcomeUnknown: false };
  }

  let request;
  try { request = normalizeWmiRequest(input); }
  catch (error) {
    return { ok: false, verified: false, error: error.message, outcomeUnknown: false };
  }

  return new Promise(resolve => {
    const child = spawnImpl('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-Query', request.query,
      '-Limit', String(request.limit),
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });

    child.once('error', error => {
      finish({ ok: false, verified: false, error: `WINDOWS_WMI_SPAWN_FAILED:${error.message}`, outcomeUnknown: false });
    });

    child.once('exit', code => {
      if (code !== 0) {
        return finish({
          ok: false,
          verified: false,
          error: `WINDOWS_WMI_EXIT_${code}:${stderr.trim().slice(0, 1000)}`,
          outcomeUnknown: false,
        });
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed?.schema !== 'jaco.windows-wmi-read/v1' || parsed?.ok !== true || parsed?.verified !== true) {
          throw new Error('WINDOWS_WMI_RECEIPT_INVALID');
        }
        const originalCount = Array.isArray(parsed.data) ? parsed.data.length : 0;
        let data = Array.isArray(parsed.data) ? [...parsed.data] : [];
        let bounded = { ...parsed, data };
        while (data.length > 1 && JSON.stringify(bounded).length > 40_000) {
          data = data.slice(0, Math.max(1, Math.floor(data.length * 0.75)));
          bounded = { ...parsed, data };
        }
        if (JSON.stringify(bounded).length > 40_000) throw new Error('WINDOWS_WMI_RESULT_TOO_LARGE');
        finish({
          ...bounded,
          count: data.length,
          originalCount,
          truncated: data.length < originalCount,
          ok: true,
          verified: true,
          outcomeUnknown: false,
        });
      } catch (error) {
        finish({
          ok: false,
          verified: false,
          error: `WINDOWS_WMI_PARSE_FAILED:${error.message}`,
          raw: stdout.trim().slice(0, 1000),
          outcomeUnknown: false,
        });
      }
    });

    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, verified: false, error: 'WINDOWS_WMI_TIMEOUT', outcomeUnknown: false });
    }, Math.max(1_000, Number(timeoutMs) || 20_000));
    timer.unref?.();
  });
}
