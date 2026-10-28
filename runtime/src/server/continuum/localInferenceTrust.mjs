/**
 * Trust boundary for cost-free local inference. A provider's self-declared
 * local=true must never convert an external URL into free cloud access.
 * These are ON-DEVICE loopback endpoints; a LAN host is not assumed trusted.
 */
export function isOnDeviceModelEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1') return true;
    if (!/^127(?:\.\d{1,3}){3}$/.test(host)) return false;
    const parts = host.split('.').map(Number);
    return parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  } catch { return false; }
}
export function assertLocalModelEndpoint(provider) {
  if (provider?.local && !isOnDeviceModelEndpoint(provider.baseUrl))
    throw new Error('LOCAL_MODEL_ENDPOINT_NOT_LOOPBACK');
}
export function validateInferenceText(text, label = 'PROVIDER') {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label}_EMPTY_INFERENCE`);
  return text;
}
