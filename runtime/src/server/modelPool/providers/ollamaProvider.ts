export interface OllamaProviderHealth {
  isHealthy: boolean;
  latencyMs: number;
  models: string[];
  error?: string;
}

export async function pingOllama(endpoint: string = 'http://127.0.0.1:11434'): Promise<OllamaProviderHealth> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        isHealthy: false,
        latencyMs: Date.now() - startTime,
        models: [],
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((m: any) => m.name || m.model) : [];

    return {
      isHealthy: true,
      latencyMs: Date.now() - startTime,
      models
    };
  } catch (err: any) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - startTime,
      models: [],
      error: err.name === 'AbortError' ? 'Timeout mot Ollama' : err.message || 'Lokal Ollama nås ej'
    };
  }
}

export async function generateOllamaCompletion(
  endpoint: string,
  model: string,
  prompt: string
): Promise<{ text: string; latencyMs: number }> {
  const startTime = Date.now();
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3.2',
      prompt,
      stream: false,
      // The Ollama app default context (65536) reserves ~6 GB of shared RAM on an iGPU and starves the machine.
      options: { num_ctx: Number(process.env.JACO_OLLAMA_NUM_CTX) || 8192 },
      keep_alive: process.env.JACO_OLLAMA_KEEP_ALIVE || '2m'
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama anrop misslyckades med HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    text: data.response || '',
    latencyMs: Date.now() - startTime
  };
}
