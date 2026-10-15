import { GoogleGenAI } from "@google/genai";

export interface GeminiProviderHealth {
  isHealthy: boolean;
  latencyMs: number;
  hasApiKey: boolean;
  error?: string;
  activeModel?: string;
  cooldownActive?: boolean;
}

let aiClient: GoogleGenAI | null = null;

// Track temporary rate limits (429 / QuotaExceeded) per model
const modelCooldownMap = new Map<string, number>();

export function isModelInCooldown(modelName: string): boolean {
  const expiresAt = modelCooldownMap.get(modelName);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    modelCooldownMap.delete(modelName);
    return false;
  }
  return true;
}

export function areAllGeminiModelsInCooldown(): boolean {
  const coreModels = ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];
  return coreModels.every(m => isModelInCooldown(m));
}

export function setModelCooldown(modelName: string, durationSeconds: number = 60) {
  modelCooldownMap.set(modelName, Date.now() + durationSeconds * 1000);
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export async function pingGemini(): Promise<GeminiProviderHealth> {
  const startTime = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - startTime,
      hasApiKey: false,
      error: 'GEMINI_API_KEY saknas i process.env'
    };
  }

  if (areAllGeminiModelsInCooldown()) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - startTime,
      hasApiKey: true,
      cooldownActive: true,
      error: 'Alla Gemini-modeller är i temporär kvot-cooldown (429 rate-limit).'
    };
  }

  try {
    const client = getAiClient();
    if (!client) {
      return {
        isHealthy: false,
        latencyMs: Date.now() - startTime,
        hasApiKey: true,
        error: 'Kunde inte initiera GoogleGenAI'
      };
    }

    const testModels = ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'].filter(m => !isModelInCooldown(m));
    let isOk = false;
    let usedModel = testModels[0] || 'gemini-2.5-flash';

    for (const m of (testModels.length > 0 ? testModels : ['gemini-2.5-flash', 'gemini-3.7-flash'])) {
      try {
        const response = await client.models.generateContent({
          model: m,
          contents: 'ping'
        });
        if (response.text) {
          isOk = true;
          usedModel = m;
          break;
        }
      } catch (err: any) {
        if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          setModelCooldown(m, 60);
        }
      }
    }

    return {
      isHealthy: isOk,
      latencyMs: Date.now() - startTime,
      hasApiKey: true,
      activeModel: usedModel,
      cooldownActive: !isOk && areAllGeminiModelsInCooldown()
    };
  } catch (err: any) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - startTime,
      hasApiKey: true,
      error: err?.message || 'Gemini ping misslyckades'
    };
  }
}

export async function generateGeminiCompletion(
  prompt: string,
  modelName: string = 'gemini-2.5-flash',
  systemPrompt?: string
): Promise<{ text: string; latencyMs: number; modelUsed: string }> {
  const startTime = Date.now();
  const client = getAiClient();

  if (!client) {
    throw new Error('GEMINI_API_KEY saknas eller är ej initierad');
  }

  // Model cascade: try requested model, then gemini-2.5-flash, gemini-3.7-flash, gemini-2.5-flash-lite, gemini-3.1-flash-lite, gemini-flash-latest
  const rawCascade = [
    modelName === 'gemini-3.6-flash' ? 'gemini-2.5-flash' : modelName,
    'gemini-2.5-flash',
    'gemini-3.7-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest'
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  // Prioritize models that are not currently in cooldown
  const availableModels = rawCascade.filter(m => !isModelInCooldown(m));
  const modelsToTry = availableModels.length > 0 ? availableModels : rawCascade;

  let lastError: any = null;
  for (const currentModel of modelsToTry) {
    try {
      const response = await client.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: systemPrompt ? { systemInstruction: systemPrompt } : undefined
      });
      if (response.text) {
        return {
          text: response.text,
          latencyMs: Date.now() - startTime,
          modelUsed: currentModel
        };
      }
    } catch (err: any) {
      lastError = err;
      const isQuota = err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.status === 'RESOURCE_EXHAUSTED';
      if (isQuota) {
        // Parse retry delay or cooldown for 60s
        setModelCooldown(currentModel, 60);
      }
    }
  }

  throw lastError || new Error('Alla modeller i Gemini-kaskaden är i kvotbegränsning (429 RESOURCE_EXHAUSTED).');
}
