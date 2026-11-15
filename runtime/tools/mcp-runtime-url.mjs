import { localServiceUrl } from '../../agents/lib/resolved-endpoints.mjs';

export function resolveMcpCoreBaseUrl(env = process.env) {
  const explicit = String(env.JACO_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const runtime = String(env.JACO_RUNTIME_URL || '').trim();
  if (runtime) return runtime.replace(/\/+$/, '');

  const core = String(env.JACO_CORE_URL || '').trim();
  if (core) return core.replace(/\/+$/, '');

  // The launcher may have moved Core off 3000 because another program held it.
  return localServiceUrl('runtime', env);
}
