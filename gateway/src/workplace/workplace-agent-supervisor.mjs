import { spawn as nodeSpawn } from 'node:child_process';
import { resolve } from 'node:path';

function normalizeToken(env = {}) {
  return env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || env.SEER_TOKEN || '';
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function probe(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_500) });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function waitForJson(url, fetchImpl, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_500) });
      if (response.ok) return true;
      lastError = new Error(`HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(500, remaining));
  }
  throw lastError || new Error(`DEPENDENCY_TIMEOUT ${url}`);
}

async function terminate(child) {
  if (!child) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill('SIGTERM'); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function asV1(value) {
  const base = String(value || 'http://127.0.0.1:9379/v1').replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function ollamaRoot(value) {
  return String(value || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function createWorkplaceAgentSupervisor({
  root = process.cwd(),
  env = process.env,
  spawnImpl = nodeSpawn,
  fetchImpl = globalThis.fetch,
  log = console.log,
  error = console.error,
  restartDelayMs = 2_000,
} = {}) {
  let modelChild = null;
  let seerChild = null;
  let novaChild = null;
  let stopping = false;
  let restartTimer = null;
  let aggregateState = 'DISABLED';
  let workplaceUrl = null;

  let modelState = 'DISABLED';
  let modelOwnership = 'none';
  let modelProvider = null;
  let lastModelExit = null;

  let seerState = 'DISABLED';
  let novaState = 'DISABLED';
  let seerOwnership = 'none';
  let lastSeerExit = null;
  let lastNovaExit = null;

  const superviseModel = env.JACO_WORKPLACE_SUPERVISE_MODEL === '1';
  const superviseNova = env.JACO_WORKPLACE_SUPERVISE_NOVA === '1';
  const superviseSeer = env.JACO_WORKPLACE_SUPERVISE_SEER === '1';
  const enabled = superviseModel || superviseNova || superviseSeer;
  const novaEntry = env.JACO_EXECUTOR === 'desktop-agentos'
    ? 'agents/run-desktop-agentos.mjs' : 'agents/hands-off-agent.mjs';

  const runtimeUrl = String(env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const seerUrl = String(env.SEER_URL || 'http://127.0.0.1:2997').replace(/\/+$/, '');
  const litertV1 = asV1(env.JACO_LITERT_URL);
  const llamaCppV1 = asV1(env.JACO_LLAMACPP_URL || 'http://127.0.0.1:9380/v1');
  const ollamaBase = ollamaRoot(env.OLLAMA_BASE_URL || env.JACO_OLLAMA_URL);

  function snapshot() {
    return {
      enabled,
      state: aggregateState,
      workplaceUrl,
      runtimeUrl,
      seerUrl,
      model: {
        supervised: superviseModel,
        state: modelState,
        ownership: modelOwnership,
        provider: modelProvider,
        pid: modelChild?.pid ?? null,
        litertUrl: litertV1,
        llamaCppUrl: llamaCppV1,
        ollamaUrl: ollamaBase,
        lastExit: lastModelExit,
      },
      seer: {
        supervised: superviseSeer,
        state: seerState,
        ownership: seerOwnership,
        pid: seerChild?.pid ?? null,
        lastExit: lastSeerExit,
      },
      nova: {
        executor: env.JACO_EXECUTOR === 'desktop-agentos' ? 'desktop-agentos' : 'nova',
        supervised: superviseNova,
        state: novaState,
        pid: novaChild?.pid ?? null,
        lastExit: lastNovaExit,
      },
    };
  }

  function sharedEnv() {
    const token = normalizeToken(env);
    const agentEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
      !/^(JACO_WORKPLACE_OPERATOR_TOKEN|JACO_CHATGPT_WORKPLACE_TOKEN|STRIPE_.*|GITHUB_TOKEN|GH_TOKEN|HUGGINGFACE_TOKEN|HF_TOKEN)$/.test(key)));
    return {
      ...agentEnv,
      // Workplace coordination is local to this supervisor. Keep any Hub
      // device credentials intact: Nova may still legitimately receive remote
      // missions via JACO_HUB_URL while using the local Workplace for tools.
      JACO_WORKPLACE_SCOPE: 'local',
      JACO_WORKPLACE_URL: workplaceUrl,
      JACO_WORKPLACE_REQUIRED: '1',
      JACO_RUNTIME_URL: runtimeUrl,
      SEER_URL: seerUrl,
      JACO_LITERT_URL: litertV1,
      JACO_LLAMACPP_URL: llamaCppV1,
      OLLAMA_BASE_URL: ollamaBase,
      ...(token ? {
        JACO_GATEWAY_TOKEN: token,
        GATEWAY_TOKEN: env.GATEWAY_TOKEN || token,
        SEER_TOKEN: env.SEER_TOKEN || token,
      } : {}),
    };
  }

  function schedule(fn) {
    if (stopping) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void fn();
    }, restartDelayMs);
  }

  async function detectProvider() {
    const preference = String(env.JACO_SEER_PROVIDER_PREFERENCE || 'auto').trim().toLowerCase();
    if (preference === 'llamacpp') {
      if (await probe(`${llamaCppV1}/models`, fetchImpl)) return { id: 'llamacpp', url: llamaCppV1 };
      return null;
    }
    if (preference === 'litert') {
      if (await probe(`${litertV1}/models`, fetchImpl)) return { id: 'litert', url: litertV1 };
      return null;
    }
    if (preference === 'ollama') {
      if (await probe(`${ollamaBase}/api/tags`, fetchImpl)) return { id: 'ollama', url: ollamaBase };
      return null;
    }
    if (await probe(`${litertV1}/models`, fetchImpl)) return { id: 'litert', url: litertV1 };
    if (await probe(`${llamaCppV1}/models`, fetchImpl)) return { id: 'llamacpp', url: llamaCppV1 };
    if (await probe(`${ollamaBase}/api/tags`, fetchImpl)) return { id: 'ollama', url: ollamaBase };
    return null;
  }

  async function waitForProvider(waitMs) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const provider = await detectProvider();
      if (provider) return provider;
      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(Math.min(500, remaining));
    }
    throw new Error('LOCAL_MODEL_PROVIDER_UNAVAILABLE');
  }

  async function ensureModel(waitMs) {
    const existing = await detectProvider();
    if (existing) {
      modelProvider = existing.id;
      modelState = 'READY';
      if (!modelChild) modelOwnership = 'external';
      return existing;
    }

    const preference = String(env.JACO_SEER_PROVIDER_PREFERENCE || 'auto').trim().toLowerCase();
    if (!superviseModel || preference === 'ollama') {
      modelState = 'WAITING_EXTERNAL';
      const provider = await waitForProvider(waitMs);
      modelProvider = provider.id;
      modelState = 'READY';
      modelOwnership = 'external';
      return provider;
    }

    if (!modelChild) {
      const useLlamaCpp = preference === 'llamacpp';
      const url = new URL(useLlamaCpp ? llamaCppV1 : litertV1);
      const host = url.hostname || '127.0.0.1';
      const port = url.port || (useLlamaCpp ? '9380' : '9379');
      modelState = 'STARTING';
      modelOwnership = 'workplace';

      const label = useLlamaCpp ? 'llama.cpp' : 'LiteRT';
      const command = useLlamaCpp
        ? (env.JACO_LLAMACPP_SERVER || env.JACO_LLAMACPP_COMMAND || 'llama-server')
        : (env.JACO_LITERT_COMMAND || 'litert-lm');
      const args = useLlamaCpp
        ? (() => {
            const model = String(env.JACO_LLAMACPP_MODEL || '').trim();
            if (!model) throw new Error('JACO_LLAMACPP_MODEL_REQUIRED');
            return [
              '-m', model,
              '-c', String(env.JACO_LLAMACPP_CTX || 8192),
              '--host', host,
              '--port', port,
              '--reasoning', String(env.JACO_LLAMACPP_REASONING || 'off'),
            ];
          })()
        : ['serve', '--host', host, '--port', port];

      const child = spawnImpl(command, args, {
        cwd: resolve(root),
        env: sharedEnv(),
        stdio: 'inherit',
        windowsHide: true,
      });
      modelChild = child;
      log(`[JACO Workplace] ${label} supervisor started PID ${child.pid}`);

      child.once('spawn', () => { modelState = 'STARTING'; });
      child.once('exit', (code, signal) => {
        lastModelExit = { code, signal, at: new Date().toISOString() };
        if (modelChild === child) modelChild = null;
        if (stopping) {
          modelState = 'STOPPED';
          return;
        }
        modelState = 'RESTARTING';
        modelProvider = null;
        aggregateState = 'RECOVERING_MODEL';
        error(`[JACO Workplace] ${label} exited code=${code} signal=${signal || 'none'}; stopping dependent agents`);
        void Promise.all([terminate(novaChild), seerOwnership === 'workplace' ? terminate(seerChild) : Promise.resolve()])
          .finally(() => {
            novaChild = null;
            novaState = 'STOPPED';
            if (seerOwnership === 'workplace') {
              seerChild = null;
              seerState = 'STOPPED';
            }
            schedule(launch);
          });
      });
      child.once('error', cause => {
        error(`[JACO Workplace] ${label} spawn error: ${cause?.message || cause}`);
      });
    }

    const provider = await waitForProvider(waitMs);
    modelProvider = provider.id;
    modelState = 'READY';
    return provider;
  }

  async function ensureSeer(waitMs) {
    if (await probe(`${seerUrl}/health`, fetchImpl)) {
      seerState = 'READY';
      if (!seerChild) seerOwnership = 'external';
      return;
    }

    if (!superviseSeer) {
      seerState = 'WAITING_EXTERNAL';
      await waitForJson(`${seerUrl}/health`, fetchImpl, waitMs);
      seerState = 'READY';
      seerOwnership = 'external';
      return;
    }

    if (!seerChild) {
      seerState = 'STARTING';
      seerOwnership = 'workplace';
      const child = spawnImpl(process.execPath, ['--experimental-sqlite', 'gateway/src/seer-start.mjs'], {
        cwd: resolve(root),
        env: sharedEnv(),
        stdio: 'inherit',
        windowsHide: true,
      });
      seerChild = child;
      log(`[JACO Workplace] SEER supervisor started PID ${child.pid}`);

      child.once('spawn', () => { seerState = 'STARTING'; });
      child.once('exit', (code, signal) => {
        lastSeerExit = { code, signal, at: new Date().toISOString() };
        if (seerChild === child) seerChild = null;
        if (stopping) {
          seerState = 'STOPPED';
          return;
        }
        seerState = 'RESTARTING';
        aggregateState = 'RECOVERING_SEER';
        error(`[JACO Workplace] SEER exited code=${code} signal=${signal || 'none'}; stopping Nova and recovering`);
        void terminate(novaChild).finally(() => {
          novaChild = null;
          novaState = 'STOPPED';
          schedule(launch);
        });
      });
      child.once('error', cause => {
        error(`[JACO Workplace] SEER spawn error: ${cause?.message || cause}`);
      });
    }

    await waitForJson(`${seerUrl}/health`, fetchImpl, waitMs);
    seerState = 'READY';
  }

  async function waitForSeerBrain(waitMs) {
    const token = normalizeToken(env);
    if (!token) throw new Error('SEER_BRAIN_TOKEN_REQUIRED');
    const deadline = Date.now() + waitMs;
    const maxTokens = Math.max(16, Math.min(512, Number(env.JACO_WORKPLACE_SEER_BRAIN_MAX_TOKENS || 128)));
    const requestTimeoutMs = Math.max(5_000, Number(env.JACO_WORKPLACE_SEER_BRAIN_TIMEOUT_MS || env.JACO_SEER_INFERENCE_TIMEOUT_MS || 180_000));
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        const response = await fetchImpl(`${seerUrl}/cortex/brain`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            system: 'JACO startup readiness probe. Return the exact requested token only.',
            user: 'Return exactly: JACO_SEER_READY',
            max_tokens: maxTokens,
            temperature: 0,
            startup_probe: true,
          }),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok === true && typeof data?.text === 'string' && data.text.trim()) {
          return data;
        }
        lastError = new Error(data?.error || `SEER_BRAIN_HTTP_${response.status}`);
      } catch (cause) {
        lastError = cause;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(Math.min(750, remaining));
    }

    throw lastError || new Error('SEER_BRAIN_NOT_READY');
  }

  async function launchNova() {
    if (!superviseNova || stopping || novaChild) return;

    novaState = 'STARTING';
    const child = spawnImpl(process.execPath, [novaEntry], {
      cwd: resolve(root),
      env: {
        ...sharedEnv(),
        NOVA_BRAIN_MODE: env.NOVA_BRAIN_MODE || 'seer',
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    novaChild = child;
    log(`[JACO Workplace] Nova supervisor started PID ${child.pid}`);

    child.once('spawn', () => {
      novaState = 'RUNNING';
      aggregateState = 'RUNNING';
    });
    child.once('exit', (code, signal) => {
      lastNovaExit = { code, signal, at: new Date().toISOString() };
      if (novaChild === child) novaChild = null;
      if (stopping) {
        novaState = 'STOPPED';
        return;
      }
      novaState = 'RESTARTING';
      aggregateState = 'RECOVERING_NOVA';
      error(`[JACO Workplace] Nova exited code=${code} signal=${signal || 'none'}; restarting`);
      schedule(launch);
    });
    child.once('error', cause => {
      error(`[JACO Workplace] Nova spawn error: ${cause?.message || cause}`);
    });
  }

  async function launch() {
    if (!enabled || stopping) return;
    const waitMs = Number(env.JACO_WORKPLACE_DEPENDENCY_WAIT_MS || env.JACO_WORKPLACE_NOVA_RUNTIME_WAIT_MS || 300_000);

    aggregateState = 'WAITING_RUNTIME';
    try {
      await waitForJson(`${runtimeUrl}/api/runtime/identity`, fetchImpl, waitMs);

      aggregateState = 'WAITING_MODEL';
      await ensureModel(waitMs);
      if (stopping) return;

      aggregateState = 'WAITING_SEER';
      await ensureSeer(waitMs);
      if (stopping) return;

      aggregateState = 'VERIFYING_SEER_BRAIN';
      const brain = await waitForSeerBrain(waitMs);
      seerState = 'READY';
      modelState = 'READY';
      if (brain?.provider) modelProvider = String(brain.provider);

      if (superviseNova) {
        aggregateState = 'STARTING_NOVA';
        await launchNova();
      } else {
        aggregateState = 'RUNNING';
      }
    } catch (cause) {
      aggregateState = 'DEPENDENCY_FAILED';
      error(`[JACO Workplace] agent supervisor dependency failed: ${cause?.message || cause}`);
      schedule(launch);
    }
  }

  async function start(url) {
    workplaceUrl = String(url || env.JACO_WORKPLACE_URL || '').replace(/\/+$/, '');
    if (!enabled) {
      aggregateState = 'DISABLED';
      return snapshot();
    }
    if (!workplaceUrl) throw new Error('WORKPLACE_SUPERVISOR_URL_REQUIRED');
    stopping = false;
    void launch();
    return snapshot();
  }

  async function stop() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;

    await terminate(novaChild);
    novaChild = null;
    novaState = 'STOPPED';

    if (seerOwnership === 'workplace') {
      await terminate(seerChild);
      seerChild = null;
    }
    seerState = seerOwnership === 'external' ? 'EXTERNAL' : 'STOPPED';

    if (modelOwnership === 'workplace') {
      await terminate(modelChild);
      modelChild = null;
    }
    modelState = modelOwnership === 'external' ? 'EXTERNAL' : 'STOPPED';
    aggregateState = 'STOPPED';
  }

  return { start, stop, snapshot };
}
