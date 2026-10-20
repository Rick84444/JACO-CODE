import net from 'node:net';
import crypto from 'node:crypto';

export type NativeBackend = 'npu' | 'gpu' | 'cpu' | 'unknown';
export type NativeTransport = 'android-tcp' | 'litert-openai' | 'none';
export type NativeEvidenceState = 'OBSERVED' | 'UNVERIFIED' | 'UNAVAILABLE';

export interface NativeEngineHealth {
  reachable: boolean;
  serviceHealthy: boolean;
  product: string | null;
  authenticated: boolean;
  healthy: boolean;
  modelId: string | null;
  backend: NativeBackend;
  runtimeVersion: string | null;
  latencyMs: number;
  /** Evidence that the selected runtime itself answered a live probe. */
  evidenceState: 'OBSERVED' | 'UNAVAILABLE';
  /** NPU is OBSERVED only when the Android engine reports backend=npu. */
  npuEvidenceState: NativeEvidenceState;
  transport: NativeTransport;
  loopbackOnly: boolean;
  error?: string;
}

interface NativeRequest {
  id: string;
  token: string;
  method: string;
  params: Record<string, unknown>;
}

interface LiteRtModel {
  id: string;
  [key: string]: unknown;
}

interface LiteRtModelsResponse {
  data?: LiteRtModel[];
  models?: LiteRtModel[];
}

interface LiteRtChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
      tool_calls?: unknown[];
    };
  }>;
}

const host = '127.0.0.1';
const port = () => Number(process.env.JACO_NATIVE_ENGINE_PORT || '37621');
const token = () => String(process.env.JACO_NATIVE_ENGINE_TOKEN || '').trim();
const litertModel = () => String(process.env.JACO_LITERT_MODEL || '').trim();

function localLiteRtBaseUrl(): URL | null {
  const configured = String(process.env.JACO_LITERT_URL || '').trim();
  if (!configured) return null;

  const url = new URL(configured);
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!['http:', 'https:'].includes(url.protocol) || !allowedHosts.has(url.hostname)) {
    throw new Error('JACO_LITERT_URL must use http(s) on a loopback host');
  }
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
  return url;
}

function unavailable(error: string, started = Date.now(), transport: NativeTransport = 'none'): NativeEngineHealth {
  return {
    reachable: false,
    serviceHealthy: false,
    product: null,
    authenticated: false,
    healthy: false,
    modelId: null,
    backend: 'unknown',
    runtimeVersion: null,
    latencyMs: Date.now() - started,
    evidenceState: 'UNAVAILABLE',
    npuEvidenceState: 'UNAVAILABLE',
    transport,
    loopbackOnly: transport !== 'none',
    error,
  };
}

function endpoint(base: URL, suffix: string): URL {
  return new URL(suffix.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
}

async function requestLiteRt<T>(
  suffix: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const base = localLiteRtBaseUrl();
  if (!base) throw new Error('JACO_LITERT_URL is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(base, suffix), {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });
    const body = await response.text();
    let parsed: any = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
    if (!response.ok) {
      const detail = parsed?.error?.message || parsed?.message || body || `${response.status} ${response.statusText}`;
      throw new Error(`LiteRT-LM server returned ${response.status}: ${String(detail).slice(0, 500)}`);
    }
    if (parsed === null) throw new Error('LiteRT-LM server returned non-JSON output');
    return parsed as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('LiteRT-LM server request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function listLiteRtModels(): Promise<LiteRtModel[]> {
  const response = await requestLiteRt<LiteRtModelsResponse>('models', { method: 'GET' }, 2_500);
  const models = Array.isArray(response?.data) ? response.data : Array.isArray(response?.models) ? response.models : [];
  return models.filter((model): model is LiteRtModel => !!model && typeof model.id === 'string' && model.id.trim().length > 0);
}

async function getLiteRtOpenAiHealth(): Promise<NativeEngineHealth> {
  const started = Date.now();
  try {
    if (!localLiteRtBaseUrl()) {
      return unavailable('No local LiteRT-LM server configured. Set JACO_LITERT_URL after starting litert-lm serve.', started);
    }
    const models = await listLiteRtModels();
    const configuredModel = litertModel();
    const selectedModel = configuredModel
      ? models.find((model) => model.id === configuredModel) || null
      : models[0] || null;
    const missingConfiguredModel = configuredModel && !selectedModel;
    return {
      reachable: true,
      serviceHealthy: true,
      product: 'LiteRT-LM OpenAI-compatible server',
      // The official CLI server has no pairing-token contract. Loopback-only is enforced above.
      authenticated: false,
      healthy: !!selectedModel,
      modelId: selectedModel?.id || null,
      backend: 'unknown',
      runtimeVersion: 'LiteRT-LM OpenAI-compatible server',
      latencyMs: Date.now() - started,
      evidenceState: 'OBSERVED',
      npuEvidenceState: 'UNVERIFIED',
      transport: 'litert-openai',
      loopbackOnly: true,
      error: missingConfiguredModel
        ? `Configured JACO_LITERT_MODEL "${configuredModel}" is not in the local LiteRT-LM registry`
        : models.length === 0
          ? 'LiteRT-LM server is reachable but has no registered models'
          : undefined,
    };
  } catch (error: any) {
    return unavailable(String(error?.message || error), started, 'litert-openai');
  }
}

export async function requestNativeEngine<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<T> {
  const pairingToken = token();
  if (!pairingToken) {
    throw new Error('JACO_NATIVE_ENGINE_TOKEN is not configured');
  }
  const request: NativeRequest = {
    id: crypto.randomUUID(),
    token: pairingToken,
    method,
    params,
  };

  return await new Promise<T>((resolve, reject) => {
    const socket = net.createConnection({ host, port: port() });
    let buffer = '';
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value as T);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        if (Buffer.byteLength(buffer) > 1_048_576) finish(new Error('Native engine response exceeded 1 MiB'));
        return;
      }
      try {
        const envelope = JSON.parse(buffer.slice(0, newline));
        if (envelope?.id !== request.id) { finish(new Error("Native engine response ID mismatch")); return; }
        if (envelope?.error) finish(new Error(String(envelope.error.message || 'Native engine request failed')));
        else finish(undefined, envelope?.result as T);
      } catch (error: any) {
        finish(new Error('Native engine returned malformed JSON: ' + error.message));
      }
    });
    socket.once('timeout', () => finish(new Error('Native engine request timed out')));
    socket.once('error', (error) => finish(error));
    socket.once('end', () => {
      if (!settled) finish(new Error('Native engine closed before returning a response'));
    });
  });
}

async function getAndroidNativeHealth(): Promise<NativeEngineHealth> {
  const started = Date.now();
  try {
    const result: any = await requestNativeEngine('health', {}, 2_500);
    const backend = ['npu', 'gpu', 'cpu'].includes(String(result?.backend).toLowerCase())
      ? String(result.backend).toLowerCase() as NativeBackend
      : 'unknown';
    if (result?.serviceHealthy !== true || result?.product !== 'JACO Native Engine') {
      return unavailable('Native engine returned an invalid health contract', started, 'android-tcp');
    }
    return {
      reachable: true,
      serviceHealthy: true,
      product: result?.product ? String(result.product) : 'JACO Native Engine',
      authenticated: true,
      healthy: result?.healthy === true,
      modelId: result?.modelId ? String(result.modelId) : null,
      backend,
      runtimeVersion: result?.runtimeVersion ? String(result.runtimeVersion) : null,
      latencyMs: Date.now() - started,
      evidenceState: 'OBSERVED',
      npuEvidenceState: result?.healthy === true && backend === 'npu' ? 'OBSERVED' : 'UNAVAILABLE',
      transport: 'android-tcp',
      loopbackOnly: true,
    };
  } catch (error: any) {
    return unavailable(String(error?.message || error), started, 'android-tcp');
  }
}

/**
 * JACO deliberately chooses one local transport at a time.
 * A configured Android pairing token takes priority; otherwise the optional
 * official LiteRT-LM loopback server is used. This prevents silent routing
 * between unrelated engines and keeps evidence attached to the real runtime.
 */
export async function getNativeEngineHealth(): Promise<NativeEngineHealth> {
  return token() ? getAndroidNativeHealth() : getLiteRtOpenAiHealth();
}

function contentText(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
  return '';
}

async function createLiteRtOpenAiCompletion(input: {
  prompt: string;
  systemPrompt?: string;
  tools?: unknown[];
  temperature?: number;
  modelId?: string;
}) {
  const health = await getLiteRtOpenAiHealth();
  if (!health.healthy || !health.modelId) throw new Error(health.error || 'No LiteRT-LM model is available');
  const modelId = input.modelId?.trim() || health.modelId;
  const started = Date.now();
  const messages = [
    ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
    { role: 'user', content: input.prompt },
  ];
  const result = await requestLiteRt<LiteRtChatResponse>('chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages,
      ...(Array.isArray(input.tools) && input.tools.length > 0 ? { tools: input.tools } : {}),
      ...(Number.isFinite(input.temperature) ? { temperature: input.temperature } : {}),
      stream: false,
    }),
  }, 120_000);
  const message = result?.choices?.[0]?.message;
  return {
    text: contentText(message?.content),
    modelId,
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    evidenceId: null,
    backend: 'unknown' as NativeBackend,
    ranOnNpu: false,
    latencyMs: Date.now() - started,
    evidenceState: 'OBSERVED' as const,
    npuEvidenceState: 'UNVERIFIED' as const,
    transport: 'litert-openai' as const,
  };
}

export async function createNativeCompletion(input: {
  prompt: string;
  systemPrompt?: string;
  tools?: unknown[];
  temperature?: number;
  modelId?: string;
}) {
  if (!token()) return createLiteRtOpenAiCompletion(input);

  const messages = [
    ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
    { role: 'user', content: input.prompt },
  ];
  const started = Date.now();
  const result: any = await requestNativeEngine('completion.create', {
    request: {
      messages,
      ...(input.modelId?.trim() ? { model: input.modelId.trim() } : {}),
      tools: Array.isArray(input.tools) ? input.tools : [],
      temperature: input.temperature,
    },
  }, 120_000);
  const health = await getAndroidNativeHealth();
  return {
    text: String(result?.text || ''),
    modelId: result?.modelId ? String(result.modelId) : health.modelId,
    toolCalls: Array.isArray(result?.toolCalls) ? result.toolCalls : [],
    evidenceId: result?.evidenceId ? String(result.evidenceId) : null,
    backend: health.backend,
    ranOnNpu: health.healthy && health.backend === 'npu',
    latencyMs: Date.now() - started,
    evidenceState: health.evidenceState,
    npuEvidenceState: health.npuEvidenceState,
    transport: 'android-tcp' as const,
  };
}

function requireAndroidPairing(operation: string): void {
  if (!token()) {
    throw new Error(`${operation} requires the Android Native Engine pairing bridge. LiteRT-LM HTTP models are imported and managed with the LiteRT-LM CLI.`);
  }
}

export async function installNativeModel(modelId: string, sourceUrl: string, sha256: string) {
  requireAndroidPairing('Model installation');
  return requestNativeEngine('model.install', { modelId, sourceUrl, sha256 }, 30 * 60_000);
}

export async function loadNativeModel(modelId: string, backend: 'auto' | 'npu' | 'gpu' | 'cpu' = 'auto') {
  requireAndroidPairing('Model loading');
  return requestNativeEngine('model.load', { modelId, backend }, 180_000);
}

export async function listNativeModels() {
  if (token()) return requestNativeEngine('models.list', {}, 10_000);
  const models = await listLiteRtModels();
  return { object: 'list', data: models };
}
