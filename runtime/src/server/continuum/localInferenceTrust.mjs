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

// A localhost Ollama daemon may proxy :cloud models to remote datacenters.
// Verify the *installed model manifest*, not just the daemon's socket address.
export function isCloudModelName(model) {
  return /(?::cloud|-cloud)$/i.test(String(model || '').trim());
}
const modelId = name => {
  const value = String(name || '').trim().toLowerCase();
  return value.includes(':') ? value : `${value}:latest`;
};
export async function assertInstalledOllamaModel({baseUrl,model,fetchImpl=globalThis.fetch,timeoutMs=3000}) {
  if(isCloudModelName(model))throw Error('OLLAMA_CLOUD_MODEL_NOT_LOCAL');
  const response=await fetchImpl(`${baseUrl}/api/tags`,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
  });
  if(!response?.ok)throw Error('OLLAMA_MODEL_CATALOG_UNAVAILABLE');
  const info=await response.json();
  if(!Array.isArray(info?.models))throw Error('OLLAMA_MODEL_CATALOG_INVALID');
  const entry=info.models.find(item=>modelId(item?.name||item?.model)===modelId(model));
  if(!entry)throw Error('OLLAMA_MODEL_NOT_INSTALLED');
  if(isCloudModelName(entry.name||entry.model)||
     String(entry.remote_host||'').trim()||String(entry.remote_model||'').trim()||
     !Number.isSafeInteger(entry.size)||entry.size<=0)
    throw Error('OLLAMA_MODEL_NOT_VERIFIABLY_LOCAL');
  return {name:entry.name||entry.model,size:entry.size};
}
