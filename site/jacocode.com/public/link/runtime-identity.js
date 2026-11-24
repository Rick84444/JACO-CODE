// Presentation only: this self-report is not a signed release attestation.
// Keep it testable without starting the PWA, network or a second runtime.
export function runtimeIdentityLabel(data){
  if(data?.success!==true || typeof data.version!=='string' || data.version.length>48 ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(data.version))
    return 'Runtime-identitet ej verifierad';
  const commit=typeof data.sourceCommit==='string' &&
    /^[a-f0-9]{40}$/.test(data.sourceCommit) ? data.sourceCommit.slice(0,12) : 'ej styrkt';
  const mode=['lite','full'].includes(data.executionProfile) ? data.executionProfile : 'okänt läge';
  return 'v'+data.version+' · '+mode+' · källcommit: '+commit+' (självrapporterat)';
}
