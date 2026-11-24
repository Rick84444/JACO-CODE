// JACO Cloud installer catalog. This module is plain JS, shared by Cloudflare's
// public *read-only* discovery API and the future paired local installer.
// Recipe IDs are static, not shell commands, URLs or user-authored scripts.
export const INSTALL_CATALOG_SCHEMA = 'jaco.install-catalog/v1';

const RECIPES = Object.freeze([
  Object.freeze({
    id:'jaco-lite-windows',version:'1.0.0',title:'JACO Lite for Windows',
    platforms:['windows'],kind:'runtime',status:'RELEASE_MANIFEST_REQUIRED',
    installer:'existing-jaco-lite',dependencies:[],
    approvals:['install-software','write-user-program-files'],
    prerequisites:['Windows PowerShell','Node.js 22.5+ for the Lite runtime'],
    validation:['SHA-256 of release archive','JACO Lite readiness probe'],
    notes:'The current release endpoint installs Lite, not the full Aura runtime.',
  }),
  Object.freeze({
    id:'ollama-windows',version:'1.0.0',title:'Ollama local model server for Windows',
    platforms:['windows'],kind:'model-server',status:'RUNNER_IMPLEMENTED',
    installer:'windows-winget-ollama',dependencies:[],
    approvals:['install-software','accept-winget-package-agreements','accept-winget-source-agreements'],
    prerequisites:['Windows 10/11 with WinGet','Sufficient device capacity'],
    validation:['WinGet package receipt','Ollama CLI identity','Ollama loopback API version'],
    notes:'No remote shell, no Ollama Cloud enrollment, no model download without separate consent.',
  }),
  Object.freeze({
    id:'ollama-qwen-coder-1p5b-windows',version:'1.0.0',
    title:'Qwen 2.5 Coder 1.5B through local Ollama',
    platforms:['windows'],kind:'model',status:'RUNNER_IMPLEMENTED',
    installer:'ollama-pull-qwen-coder',dependencies:['ollama-windows'],
    approvals:['download-model','consume-local-storage'],
    prerequisites:['Working local Ollama installation','Enough RAM and disk space'],
    validation:['Ollama model metadata','Successful generated completion','Recorded model digest'],
    notes:'qwen2.5-coder:1.5b is a mutable registry tag; capture actual digest and receipt after pull.',
  }),
  Object.freeze({
    id:'bonsai-llamacpp-existing-windows',version:'1.0.0',
    title:'Connect a preinstalled Bonsai GGUF via llama.cpp on Windows',
    platforms:['windows'],kind:'model',status:'PREREQUISITES_REQUIRED',
    installer:'existing-windows-localmodel',dependencies:[],
    approvals:['start-local-model-process'],
    prerequisites:['Operator-provided GGUF','Compatible verified llama-server.exe'],
    validation:['Existing Start-JACO-LocalModel.ps1 checks','Loopback inference completion'],
    notes:'Does not yet download unpinned GGUF or an unknown llama.cpp binary.',
  }),
  Object.freeze({
    id:'bonsai-termux-existing-android',version:'1.0.0',
    title:'Connect an existing on-device Bonsai model in Termux',
    platforms:['android-termux'],kind:'model',status:'PREREQUISITES_REQUIRED',
    installer:'existing-jacoctl',dependencies:[],
    approvals:['connect-local-inference'],
    prerequisites:['Existing Termux JACO runtime','Compatible llama.cpp and Bonsai model'],
    validation:['jacoctl status','Real local inference probe'],
    notes:'Optional inference node, not a requirement for the Android ChatGPT remote client.',
  }),
  Object.freeze({
    id:'jaco-android-chat-remote',version:'1.0.0',
    title:'Use ChatGPT Android as a JACO remote control',
    platforms:['android-chat'],kind:'client',status:'EXTERNAL_OAUTH_REQUIRED',
    installer:'no-local-runtime',dependencies:[],
    approvals:['connect-chatgpt-account','pair-aura-device'],
    prerequisites:['Published JACO Control OAuth/MCP app','Paired Aura host'],
    validation:['User-scoped OAuth grant','Authenticated device status'],
    notes:'Not published or usable from a new ChatGPT conversation yet.',
  }),
]);

const CATALOG = new Map(RECIPES.map(recipe=>[recipe.id,recipe]));
export function installRecipes({platform}={}) {
  if(platform !== undefined && !['windows','linux','macos','android-termux','android-chat'].includes(platform))
    throw Error('INSTALL_PLATFORM_UNSUPPORTED');
  return RECIPES.filter(r=>!platform||r.platforms.includes(platform))
    .map(r=>structuredClone(r));
}
export function installRecipe(id,platform) {
  const recipe=CATALOG.get(id);
  if(!recipe) throw Error('INSTALL_RECIPE_UNKNOWN');
  if(!recipe.platforms.includes(platform)) throw Error('INSTALL_PLATFORM_UNSUPPORTED');
  return structuredClone(recipe);
}
export function installRecipePlan(id,platform) {
  const recipe=installRecipe(id,platform);
  return {
    schema:'jaco.install-recipe-plan/v1',status:'PLAN_ONLY',
    recipe,agent:'Aura',agentCount:1,
    localDeviceRequired:recipe.installer!=='no-local-runtime',
    operatorApproval:'REQUIRED',
    execution:'NOT_STARTED',remoteExecution:'NOT_CONNECTED',
    security:'Local executor must resolve a fixed allowlisted recipe; never run commands supplied by a remote plan.',
  };
}
