// Provider-owned endpoints and public setup references. Selecting a preset
// only fills the existing operator form; it never installs or authenticates.
export const MCP_INTEGRATION_CATALOG = Object.freeze([
  {id:'openai-docs',name:'OpenAI developer docs',target:'https://developers.openai.com/mcp',icon:'mcp',tokenEnv:'',auth:'Public documentation',docs:'https://developers.openai.com/learn/docs-mcp'},
  {id:'microsoft-learn',name:'Microsoft Learn',target:'https://learn.microsoft.com/api/mcp',icon:'mcp',tokenEnv:'',auth:'Public documentation',docs:'https://learn.microsoft.com/en-us/training/support/mcp-developer-reference'},
  {id:'cloudflare-docs',name:'Cloudflare docs',target:'https://docs.mcp.cloudflare.com/mcp',icon:'cloudflare',tokenEnv:'',auth:'Documentation; server may request authentication',docs:'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/'},
  {loginUrl:'https://github.com/settings/tokens',id:'github-remote',name:'GitHub remote',target:'https://api.githubcopilot.com/mcp/',icon:'github',tokenEnv:'GITHUB_TOKEN',auth:'Operator-provided token reference; OAuth not yet supported by JACO MCP host',docs:'https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/set-up-the-github-mcp-server'},
  {loginUrl:'https://dashboard.render.com/',id:'render',name:'Render',target:'https://mcp.render.com/mcp',icon:'mcp',tokenEnv:'RENDER_API_KEY',auth:'Operator-provided API-key reference; OAuth not yet supported by JACO MCP host',docs:'https://render.com/docs/mcp-server'},
  {loginUrl:'https://huggingface.co/settings/tokens',id:'huggingface',name:'Hugging Face',target:'https://huggingface.co/mcp',icon:'huggingface',tokenEnv:'',auth:'Public tools; optional HF_TOKEN for authenticated access',docs:'https://huggingface.co/docs/hub/hf-mcp-server'},
  {id:'cloudflare-api',name:'Cloudflare API',target:'https://mcp.cloudflare.com/mcp',icon:'cloudflare',tokenEnv:'CLOUDFLARE_API_TOKEN',loginUrl:'https://dash.cloudflare.com/',auth:'Scoped API token; Code Mode execution requires existing write authority',docs:'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/'},
  {id:'linear',name:'Linear',target:'https://mcp.linear.app/mcp',icon:'mcp',tokenEnv:'LINEAR_API_KEY',loginUrl:'https://linear.app/',auth:'Restricted API key or OAuth (manual key setup supported here)',docs:'https://linear.app/docs/mcp'},
  {id:'context7',name:'Context7',target:'https://mcp.context7.com/mcp',icon:'mcp',tokenEnv:'CONTEXT7_API_KEY',loginUrl:'https://context7.com/',auth:'Bearer API key for documentation tools',docs:'https://context7.com/docs/installation'},
  {id:'stripe',name:'Stripe',target:'https://mcp.stripe.com/',icon:'mcp',tokenEnv:'STRIPE_MCP_API_KEY',loginUrl:'https://dashboard.stripe.com/',auth:'Restricted API key; read-only test access recommended; no payment authorization',docs:'https://github.com/stripe/ai/tree/main/tools/modelcontextprotocol'}
, 
  {id:'buffer',name:'Buffer',target:'https://mcp.buffer.com/mcp',icon:'mcp',tokenEnv:'BUFFER_API_KEY',loginUrl:'https://publish.buffer.com/',auth:'Bearer API key; whole account scope. Start read-only.',docs:'https://developers.buffer.com/guides/integrations/other-ai-tools.html',category:'marketing',purpose:'Social channels, post drafts, queue and analytics'},
  {id:'mailchimp-docs',name:'Mailchimp Docs',target:'https://mailchimp.com/developer/_mcp/server',icon:'mcp',tokenEnv:'',auth:'Public documentation only; no account access',docs:'https://mailchimp.com/developer/marketing/build/ai-tools/mcp-server',category:'marketing',purpose:'Campaign API documentation'}
].map(item=>Object.freeze(item)));
export function mcpCatalogDraft(id) {
  const preset=MCP_INTEGRATION_CATALOG.find(item=>item.id===id);
  if(!preset) throw Error('MCP_CATALOG_UNKNOWN');
  return {id:preset.id,name:preset.name,target:preset.target,icon:preset.icon,tokenEnv:preset.tokenEnv,agentAccess:'read',allowOpenLogin:false};
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

// Match only the official registered endpoint and credential reference. Never derive a login URL from server output.
export function pluginLoginPreset(id, definition) {
  const preset=MCP_INTEGRATION_CATALOG.find(p=>p.id===id && p.loginUrl);
  if(!preset || !definition || definition.transport!=='http' || definition.validationError || definition.agentAccess==='off') return null;
  try { if(new URL(definition.url).href!==new URL(preset.target).href) return null; } catch { return null; }
  const refs=id==='huggingface'?['','HF_TOKEN','HUGGINGFACE_TOKEN']:[preset.tokenEnv||''];
  return refs.includes(definition.tokenEnv||'')?preset:null;
}

export const MARKETPLACE_DIRECTORY=Object.freeze([
  {id:'hubspot',name:'HubSpot',category:'marketing',purpose:'CRM, campaigns and leads',status:'OAUTH_REQUIRED',docs:'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server'},
  {id:'semrush',name:'Semrush',category:'marketing',purpose:'SEO and competitor research',status:'ADAPTER_REQUIRED',docs:'https://developer.semrush.com/api/v4/introduction/semrush-mcp/'},
  {id:'klaviyo',name:'Klaviyo',category:'marketing',purpose:'Email and campaign analytics',status:'OAUTH_REQUIRED',docs:'https://www.klaviyo.com/solutions/ai/klaviyo-mcp-server'},
  {id:'etsy',name:'Etsy',category:'commerce',purpose:'Digital products and listing drafts',status:'ADAPTER_REQUIRED',docs:'https://developers.etsy.com/documentation/tutorials/listings/'},
  {id:'shopify',name:'Shopify',category:'commerce',purpose:'Store products and orders',status:'ADAPTER_REQUIRED',docs:'https://shopify.dev/docs/apps/build/authentication-authorization'},
  {id:'ebay',name:'eBay',category:'commerce',purpose:'Marketplace inventory and offers',status:'ADAPTER_REQUIRED',docs:'https://developer.ebay.com/develop/guides/sell/ebay-apis-mcp-server-agentic-ai-assistant'},
  {id:'tiktok',name:'TikTok Direct',category:'marketing',purpose:'Direct content posting requires approved app',status:'ADAPTER_REQUIRED',docs:'https://developers.tiktok.com/docs/en/content-posting-api-get-started'},
  {id:'youtube',name:'YouTube Direct',category:'marketing',purpose:'Video uploads via user OAuth',status:'ADAPTER_REQUIRED',docs:'https://developers.google.com/youtube/data/guides/uploading_a_video'},
  {id:'jobbi',name:'Jobbi',category:'marketplace',purpose:'Existing public gig discovery',status:'EXISTING_HOST',docs:'https://jobbi.org/'},
  {id:'frantic',name:'Frantic',category:'marketplace',purpose:'Existing public bounty discovery',status:'EXISTING_HOST',docs:'https://gofrantic.com/'}
].map(Object.freeze));
export const pluginCategory=p=>p.category || (p.id==='stripe'?'commerce':['render','cloudflare-api','cloudflare-docs'].includes(p.id)?'cloud':'development');
export function marketplaceEntries(providers=[]){
  return MARKETPLACE_DIRECTORY.map(p=>({...p,state:p.status==='EXISTING_HOST'?mcpConnectionState(providers.find(v=>v.id===p.id)):p.status}));
}
