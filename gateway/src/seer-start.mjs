// JACO SEER model bootstrap
// Cross-platform local inference discovery:
//   1. healthy LiteRT-LM / Gemma (preferred when available, typically Android)
//   2. healthy Ollama model (desktop/local fallback)
// Provider identity is preserved so /cortex/brain reports what actually ran.

import 'dotenv/config';
import { applySeerLocalProvider, discoverSeerLocalProvider } from './seer-model-provider.mjs';
import { plannerChoiceFile, readPlannerChoice } from '../../agents/lib/planner-choice.mjs';

const preference = String(process.env.JACO_SEER_PROVIDER_PREFERENCE || 'auto').trim().toLowerCase();
const choice = preference === 'auto' && !process.env.JACO_PRIMARY_PROVIDER
  ? readPlannerChoice(plannerChoiceFile()) : null;
const selected = choice?.by === 'operator' && choice.provider && choice.model
  ? { provider: null, preference: 'aura', reason: 'AURA_OPERATOR_CHOICE' }
  : await discoverSeerLocalProvider();

if (selected.provider) {
  delete process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER;
  applySeerLocalProvider(selected.provider);
  console.log(
    `[SEER] Selected provider: ${selected.provider.id} model=${selected.provider.model} execution=${selected.provider.local ? 'local' : 'cloud'} source=${selected.provider.source}`,
  );
} else if (selected.reason === 'AURA_OPERATOR_CHOICE') {
  console.log('[SEER] Awaiting verified inference from the saved Aura model choice');
} else {
  process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER = '1';
  console.warn(
    `[SEER] No verified local model provider selected (preference=${selected.preference}; ${selected.reason})`,
  );
}

await import('./seer.mjs');

