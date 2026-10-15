export async function seerCompletionResult(
  {system,user,image,max_tokens=1024,temperature=0.3,memory_chars},
  fetchImpl=fetch
) {
  const base=(process.env.SEER_URL || 'http://127.0.0.1:2997').replace(/\/$/,'');
  const token=process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || process.env.SEER_TOKEN || '';
  const response=await fetchImpl(base+'/cortex/brain', {
    method:'POST',
    headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({system,user,image,max_tokens,temperature,memory_chars}),
    signal:AbortSignal.timeout(Number(process.env.JACO_SEER_CLIENT_TIMEOUT_MS || 200000)),
  });
  const result=await response.json().catch(()=>({}));
  if (!response.ok || result.ok!==true || typeof result.text!=='string' || !result.text.trim()) {
    const failures = Array.isArray(result.failures)
      ? result.failures.slice(-8).map(f => [
          f?.provider || 'unknown',
          f?.code || 'FAILED',
          f?.status || null,
        ].filter(Boolean).join(':')).join(' | ')
      : '';
    const baseError = result.error || `SEER_BRAIN_HTTP_${response.status}`;
    throw new Error(failures ? `${baseError} [${failures}]` : baseError);
  }
  return {
    ...result,
    text: result.text.trim(),
    provider: String(result.provider || 'unknown'),
    model: String(result.model || 'unknown'),
    local: result.local === true,
  };
}

export async function seerCompletion(args, fetchImpl=fetch) {
  return (await seerCompletionResult(args, fetchImpl)).text;
}
