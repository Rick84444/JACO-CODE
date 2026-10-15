export function resolveMcpCoreBaseUrl(env = process.env) {
  const explicit = String(env.JACO_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const runtime = String(env.JACO_RUNTIME_URL || '').trim();
  if (runtime) return runtime.replace(/\/+$/, '');

  const core = String(env.JACO_CORE_URL || '').trim();
  if (core) return core.replace(/\/+$/, '');

  return 'http://127.0.0.1:3000';
}
