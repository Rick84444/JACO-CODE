// Provider-owned endpoints and public setup references. Selecting a preset
// only fills the existing operator form; it never installs or authenticates.
export const MCP_INTEGRATION_CATALOG = Object.freeze([
  {id:'openai-docs',name:'OpenAI developer docs',target:'https://developers.openai.com/mcp',icon:'mcp',tokenEnv:'',auth:'Public documentation',docs:'https://developers.openai.com/learn/docs-mcp'},
  {id:'microsoft-learn',name:'Microsoft Learn',target:'https://learn.microsoft.com/api/mcp',icon:'mcp',tokenEnv:'',auth:'Public documentation',docs:'https://learn.microsoft.com/en-us/training/support/mcp-developer-reference'},
  {id:'cloudflare-docs',name:'Cloudflare docs',target:'https://docs.mcp.cloudflare.com/mcp',icon:'cloudflare',tokenEnv:'',auth:'Documentation; server may request authentication',docs:'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/'},
  {id:'github-remote',name:'GitHub remote',target:'https://api.githubcopilot.com/mcp/',icon:'github',tokenEnv:'GITHUB_TOKEN',auth:'Operator-provided token reference; OAuth not yet supported by JACO MCP host',docs:'https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/set-up-the-github-mcp-server'},
  {id:'render',name:'Render',target:'https://mcp.render.com/mcp',icon:'mcp',tokenEnv:'RENDER_API_KEY',auth:'Operator-provided API-key reference; OAuth not yet supported by JACO MCP host',docs:'https://render.com/docs/mcp-server'},
  {id:'huggingface',name:'Hugging Face',target:'https://huggingface.co/mcp',icon:'huggingface',tokenEnv:'',auth:'Public tools; optional HF_TOKEN for authenticated access',docs:'https://huggingface.co/docs/hub/hf-mcp-server'}
].map(item=>Object.freeze(item)));
export function mcpCatalogDraft(id) {
  const preset=MCP_INTEGRATION_CATALOG.find(item=>item.id===id);
  if(!preset) throw Error('MCP_CATALOG_UNKNOWN');
  return {id:preset.id,name:preset.name,target:preset.target,icon:preset.icon,tokenEnv:preset.tokenEnv,agentAccess:'read'};
}
export function mcpConnectionState(provider, observed=true) {
  if (!provider) return 'AVAILABLE';
  if (!observed || provider.status==='UNOBSERVED') return 'UNOBSERVED';
  if (provider.agentAccess==='off') return 'AGENT_ACCESS_OFF';
  if (provider.credentialConfigured===false || /MCP_(?:AUTH|CREDENTIAL)_REQUIRED/.test(provider.error||'')) return 'AUTH_REQUIRED';
  if (provider.status==='FAILED') return 'ERROR';
  if (provider.status==='STARTING') return 'CONNECTING';
  if (provider.status==='READY') return 'TOOLS_DISCOVERED';
  return 'CONFIGURED';
}
