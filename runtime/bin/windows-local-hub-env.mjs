// Windows Sentinel is the hub receiver. A leftover remote device pairing in
// the checkout .env must not silently turn its local executor into a joined device.
// The operator can opt out explicitly for an intentionally joined-device setup.
export function applyWindowsHubRole(env) {
  if (!env || typeof env !== 'object') throw new Error('JACO_WINDOWS_ENV_REQUIRED');
  if (env.JACO_WINDOWS_LOCAL_HUB === '0') return { localHub: false };
  env.JACO_HUB_URL = '';
  env.JACO_DEVICE_KEY = '';
  env.JACO_NOVA_EXECUTOR = 'nova';
  env.JACO_WORKPLACE_SCOPE = 'local';
  // Only Aura accepts operator goals. Nova still executes durable missions
  // but cannot poll its historical direct GitHub command inbox.
  env.JACO_AURA_ONLY_OPERATOR = '1';
  return { localHub: true };
}
