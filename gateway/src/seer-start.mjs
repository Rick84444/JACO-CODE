// JACO SEER model bootstrap
// Cross-platform local inference discovery:
//   1. healthy LiteRT-LM / Gemma (preferred when available, typically Android)
//   2. healthy Ollama model (desktop/local fallback)
// Provider identity is preserved so /cortex/brain reports what actually ran.

import 'dotenv/config';
import { applySeerLocalProvider, discoverSeerLocalProvider } from './seer-model-provider.mjs';

const selected = await discoverSeerLocalProvider();

if (selected.provider) {
  delete process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER;
  applySeerLocalProvider(selected.provider);
  console.log(
    `[SEER] Selected provider: ${selected.provider.id} model=${selected.provider.model} execution=${selected.provider.local ? 'local' : 'cloud'} source=${selected.provider.source}`,
  );
} else {
  process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER = '1';
  console.warn(
    `[SEER] No verified local model provider selected (preference=${selected.preference}; ${selected.reason})`,
  );
}

await import('./seer.mjs');
