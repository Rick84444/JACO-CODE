// Canonical classification for account creation in Aura's browser. A registration
// screen is not an identity provider: the operator still owns authentication,
// Google consent, password entry, MFA, CAPTCHAs and payment authorization.
const REGISTRATION_PATH = /(?:^|\/)(?:signup|sign-up|register|registration|create[-_]?account|join[-_]?now)(?:\/|$)/i;
const IDENTITY_PATH = /(?:^|\/)(?:login|log-in|signin|sign-in|oauth|authorize|auth\/callback|2fa|mfa|verify[-_]?identity)(?:\/|$)/i;
const SENSITIVE_HOST = /(?:^|\.)(?:accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com|paypal\.com|checkout\.stripe\.com|bankid\.com)$/i;

export function accountPageKind(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return 'invalid';
    if (SENSITIVE_HOST.test(url.hostname) || IDENTITY_PATH.test(url.pathname)) return 'operator-auth';
    if (REGISTRATION_PATH.test(url.pathname)) return 'registration';
    return 'other';
  } catch { return 'invalid'; }
}

export function validateAccountSetupGrant(input, allowedOrigins = []) {
  if (!input || input.enabled !== true) return null;
  if (input.execution_mode !== 'autonomous' || input.operator_confirmed !== true) throw Error('ACCOUNT_SETUP_OPERATOR_CONFIRMATION_REQUIRED');
  if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(String(input.mission_id || ''))) throw Error('ACCOUNT_SETUP_MISSION_REQUIRED');
  if (!Array.isArray(input.origins) || input.origins.length < 1 || input.origins.length > 5) throw Error('ACCOUNT_SETUP_ORIGINS_REQUIRED');
  const origins = [...new Set(input.origins.map(raw => {
    const url = new URL(String(raw));
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || accountPageKind(url.toString()) !== 'other') throw Error('ACCOUNT_SETUP_ORIGIN_INVALID');
    return url.origin;
  }))];
  if (allowedOrigins.length && origins.some(origin => !allowedOrigins.includes(origin))) throw Error('ACCOUNT_SETUP_ORIGIN_OUT_OF_SCOPE');
  return { enabled:true, execution_mode:'autonomous', operator_confirmed:true, mission_id:String(input.mission_id), origins };
}

export function accountPageDecision(rawUrl, accountSetup, missionId) {
  const kind=accountPageKind(rawUrl);
  if (kind==='operator-auth') return { allowed:false, reason:'OPERATOR_AUTH_HANDOFF_REQUIRED', next:'Ask the operator to sign in or grant Google consent, then observe the returned page.' };
  if (kind==='invalid') return { allowed:false, reason:'ACCOUNT_PAGE_URL_INVALID', next:'Check the address and use a normal HTTPS page.' };
  if (kind!=='registration') return { allowed:true };
  const url=new URL(rawUrl);
  if (!accountSetup?.enabled || accountSetup.operator_confirmed!==true || accountSetup.execution_mode!=='autonomous' ||
    accountSetup.mission_id!==missionId || !accountSetup.origins?.includes(url.origin)) {
    return { allowed:false, reason:'ACCOUNT_SETUP_GRANT_REQUIRED', next:'Request an explicit, origin-bound account setup grant for this autonomous mission.' };
  }
  return { allowed:true };
}

export function accountOutcomeReport({attempted = false,verified = false,blocker = '',target = ''} = {}) {
  if (verified) return {status:'VERIFIED',message:'The requested account workflow was verified.',nextSteps:[]};
  if (!attempted) return {status:'NOT_ATTEMPTED',message:'No browser account operation has been executed.',nextSteps:['Connect a permitted CDP tab and a mission-scoped account setup grant.']};
  const reason=String(blocker||'RESULT_UNVERIFIED').slice(0,240);
  return {status:'BLOCKED',message:`Could not verify account creation for ${String(target).slice(0,120)||'the requested site'}: ${reason}`,nextSteps:[
    'If sign-in, Google consent, verification or CAPTCHA is required, ask the operator to complete it in the browser.',
    'Re-observe the website after the handoff and retry only the remaining steps.',
    'If the website disallows automated registration, report that limitation and recommend manual registration or an official API.',
  ]};
}
