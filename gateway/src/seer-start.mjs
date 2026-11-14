// JACO strategy runtime bootstrap (historical SEER service name).
// In the canonical Aura runtime, provider selection belongs to Aura and is read on every inference turn.
// Local discovery remains only for callers that run this compatibility service outside the canonical launcher.

import 'dotenv/config';
import { applySeerLocalProvider, discoverSeerLocalProvider } from './seer-model-provider.mjs';

if (process.env.JACO_AURA_UNIFIED_RUNTIME === '1' || process.env.JACO_SEER_PROVIDER_PREFERENCE === 'aura') {
  delete process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER;
  console.log('[JACO Aura] Strategy capability uses Aura provider selection; no local model prerequisite.');
} else {
  const selected = await discoverSeerLocalProvider();
  if (selected.provider) {
    delete process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER;
    applySeerLocalProvider(selected.provider);
    console.log(
      `[JACO strategy compatibility] Selected provider: ${selected.provider.id} model=${selected.provider.model} execution=${selected.provider.local ? 'local' : 'cloud'} source=${selected.provider.source}`,
    );
  } else {
    process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER = '1';
    console.warn(
      `[JACO strategy compatibility] No provider selected (preference=${selected.preference}; ${selected.reason})`,
    );
  }
}

await import('./seer.mjs');
