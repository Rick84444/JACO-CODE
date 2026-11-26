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
,
  {id:'coingecko',name:'CoinGecko',target:'https://mcp.api.coingecko.com/mcp',icon:'mcp',tokenEnv:'',auth:'Public beta, shared limits; light research only',docs:'https://mcp.api.coingecko.com/',category:'finance',purpose:'Public crypto market data'},
  {id:'paypal-sandbox',name:'PayPal Sandbox',target:'https://mcp.sandbox.paypal.com/http',icon:'mcp',tokenEnv:'PAYPAL_SANDBOX_ACCESS_TOKEN',loginUrl:'https://developer.paypal.com/dashboard/',auth:'Externally obtained short-lived sandbox Bearer token; no live payments',docs:'https://developer.paypal.com/ai-tools/mcp-server/',category:'finance',purpose:'Test account and transaction research'}
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
,
  {"id":"paypal","name":"PayPal","category":"finance","purpose":"Live payment account; OAuth integration required","status":"OAUTH_REQUIRED","docs":"https://developer.paypal.com/ai-tools/mcp-server/"},
  {"id":"square","name":"Square","category":"finance","purpose":"Orders and payments","status":"OAUTH_REQUIRED","docs":"https://developer.squareup.com/docs/mcp"},
  {"id":"chargebee","name":"Chargebee","category":"finance","purpose":"Subscription analytics; tenant-specific endpoint","status":"ADAPTER_REQUIRED","docs":"https://www.chargebee.com/docs/billing/2.0/ai-in-chargebee/chargebee-mcp"},
  {"id":"fortnox","name":"Fortnox","category":"finance","purpose":"Swedish bookkeeping and invoices","status":"OAUTH_REQUIRED","docs":"https://www.fortnox.se/developer/authorization"},
  {"id":"xero","name":"Xero","category":"finance","purpose":"Accounting and reconciliation","status":"ADAPTER_REQUIRED","docs":"https://github.com/XeroAPI/xero-mcp-server"},
  {"id":"quickbooks","name":"QuickBooks","category":"finance","purpose":"Accounting and reports","status":"ADAPTER_REQUIRED","docs":"https://developer.intuit.com/"},
  {"id":"mercury","name":"Mercury","category":"finance","purpose":"Business account balances and transactions","status":"OAUTH_REQUIRED","docs":"https://docs.mercury.com/docs/what-is-mercury-mcp"},
  {"id":"alphavantage","name":"Alpha Vantage","category":"finance","purpose":"Equity and FX research; OAuth or query key","status":"OAUTH_REQUIRED","docs":"https://mcp.alphavantage.co/"},
  {"id":"financialmodelingprep","name":"Financial Modeling Prep","category":"finance","purpose":"Financial statements and market data; custom API header","status":"ADAPTER_REQUIRED","docs":"https://site.financialmodelingprep.com/developer/docs/mcp-server"},
  {"id":"alpaca","name":"Alpaca","category":"finance","purpose":"Market data and paper trading only","status":"ADAPTER_REQUIRED","docs":"https://docs.alpaca.markets/us/docs/trading-api-mcp"},
  {"id":"riksbanken","name":"Riksbanken","category":"finance","purpose":"Official rates and exchange rates","status":"ADAPTER_REQUIRED","docs":"https://developer.api.riksbank.se/apis"},
  {"id":"coinbase","name":"Coinbase AgentKit","category":"finance","purpose":"Owner-controlled wallet infrastructure; no signing adapter","status":"ADAPTER_REQUIRED","docs":"https://github.com/coinbase/agentkit"},
  {"id":"wise","name":"Wise","category":"finance","purpose":"International account and currency reporting","status":"ADAPTER_REQUIRED","docs":"https://docs.wise.com/"},
  {"id":"x402","name":"x402","category":"finance","purpose":"Machine-readable payment protocol; no outgoing payment adapter","status":"ADAPTER_REQUIRED","docs":"https://www.x402.org/"}
].map(Object.freeze));
export const pluginCategory=p=>p.category || (p.id==='stripe'?'finance':['render','cloudflare-api','cloudflare-docs'].includes(p.id)?'cloud':'development');
export function marketplaceEntries(providers=[]){
  return MARKETPLACE_DIRECTORY.map(p=>({...p,state:p.status==='EXISTING_HOST'?mcpConnectionState(providers.find(v=>v.id===p.id)):p.status}));
}

// Shared strategy projection: candidates are not grants, goals, or verified results.
export function financialOptions(providers=null){
  const observed=Array.isArray(providers);
  const rows=observed?providers:[];
  const plugins=[...MCP_INTEGRATION_CATALOG.filter(p=>pluginCategory(p)==='finance').map(p=>({id:p.id,name:p.name,purpose:p.purpose||'Revenue and billing data',docs:p.docs,state:observed?mcpConnectionState(rows.find(r=>r.id===p.id)):'UNOBSERVED'})),...marketplaceEntries(rows).filter(p=>p.category==='finance')];
  const groups=[
    {id:'revenue-review',title:'Revenue review',titleSv:'Intäktsanalys',plugins:['stripe','paypal-sandbox','paypal','square','chargebee'],goal:'Review observed revenue, fees and subscription metrics. Do not create payments.'},
    {id:'market-research',title:'Market research',titleSv:'Marknadsanalys',plugins:['coingecko','alphavantage','financialmodelingprep','alpaca','riksbanken'],goal:'Collect sourced market data and compare scenarios. Do not place trades.'},
    {id:'accounting-review',title:'Accounting review',titleSv:'Bokföring och avstämning',plugins:['fortnox','xero','quickbooks','stripe'],goal:'Compare authorized accounting and transaction records, prepare reconciliation suggestions.'},
    {id:'capital-overview',title:'Capital overview',titleSv:'Kapitalöversikt',plugins:['mercury','wise','coinbase','x402','stripe'],goal:'Review observed balances and costs without moving funds or signing transactions.'}
  ];
  return {observed,plugins,strategies:groups.map(g=>({...g,plugins:g.plugins.map(id=>plugins.find(p=>p.id===id)).filter(Boolean),state:!observed?'UNOBSERVED':g.plugins.some(id=>rows.some(r=>r.id===id&&r.status==='READY'&&r.agentAccess!=='off'&&r.credentialConfigured!==false&&r.tools?.some(t=>t.readOnly===true&&t.agentAllowed===true)))?'READ_TOOLS_DISCOVERED':'SETUP_OR_DISCOVERY_REQUIRED',executionVerified:false,financialMutationAllowed:false}))};
}
