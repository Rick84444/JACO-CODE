export interface OllamaLocalEngineOptions {
  model: string;
  quantization?: string;
  maxContext?: number;
  gpuLayers?: number;
  npuLayers?: number;
  useNPU?: boolean;
  numThreads?: number;
  multimodal?: boolean;
  flashAttention?: boolean;
  batchSize?: number;
  temperature?: number;
  kvCacheQuantization?: string;
}

export class OllamaLocalEngine {
  private model: string;

  constructor(options: OllamaLocalEngineOptions) {
    this.model = options.model;
  }

  async parseVoiceIntent(command: string, options?: { images?: string[] }) {
    return {
      category: 'REFACTOR',
      command,
      confidence: 0.96,
      images: options?.images
    };
  }

  async runAgenticCycle(params: { intent: any; files: any[]; images?: string[]; autoPatch: boolean; onStream?: (chunk: string) => void }) {
    if (params.onStream) {
      params.onStream(`Agentic cycle running for model ${this.model}...`);
    }
    return {
      status: 'success',
      patchedFiles: params.files.length,
      model: this.model
    };
  }

  async generateStream(params: { prompt: string; images?: string[]; onStream?: (chunk: string) => void }) {
    if (params.onStream) {
      params.onStream(`Generating response for: ${params.prompt.slice(0, 30)}...`);
    }
    return { status: 'success' };
  }

  async generate(params: { prompt: string; images?: string[] }) {
    return `Generated output for prompt "${params.prompt}" on ${this.model}.`;
  }
}
