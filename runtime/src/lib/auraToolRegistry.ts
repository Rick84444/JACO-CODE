export type AuraToolCategory =
  | 'Code'
  | 'Missions'
  | 'Runtime'
  | 'Models'
  | 'Connections'
  | 'Observability'
  | 'Memory'
  | 'Security'
  | 'Economy'
  | 'Marketplace'
  | 'Devices'
  | 'Experimental'
  | 'Collaboration';

export interface AuraProductTool {
  id: string;
  title: string;
  description: string;
  category: AuraToolCategory;
  command: string;
  aliases: string[];
  kind: 'VIEW' | 'WORKFLOW' | 'RESOURCE';
  authority: 'ALLOW' | 'REVIEW' | 'VERIFY';
  surface: string;
  legacySurface: boolean;
}

const tool = (
  id: string,
  title: string,
  category: AuraToolCategory,
  surface: string,
  description: string,
  aliases: string[] = [],
  authority: AuraProductTool['authority'] = 'ALLOW',
  kind: AuraProductTool['kind'] = 'VIEW',
  legacySurface = true,
): AuraProductTool => ({
  id, title, category, surface, description, aliases, authority, kind,
  command: `>${id}`,
  legacySurface,
});


export const AURA_PRODUCT_TOOLS: AuraProductTool[] = [
  tool('git.source-control','Git Source Control','Code','aura-ide','Read/write repository state and execute structured stage, commit, fetch, pull, push and merge actions under the Level-5 operator profile with receipts.',['git','source control','diff','commit','push','merge'],'ALLOW','WORKFLOW',false),
  tool('mcp.fabric','MCP Tool Fabric','Connections','aura-ide','Inspect live MCP runtimes, select tools, call read-only or authority-gated tools, and stage provenance-pinned Git MCP sources.',['mcp','tools','tool fabric'],'VERIFY','RESOURCE',false),
  tool('remote.control','Remote / Desktop','Connections','aura-ide','Inspect Remote Bridge readiness, visible VS Code windows and verified Desktop AgentOS observations.',['remote','desktop','windows','agentos'],'VERIFY','RESOURCE',false),
  tool('browser.cdp','Chrome CDP','Connections','aura-ide','Inspect the CDP bridge and verified browser targets; browser mutation remains on canonical hands-off authority.',['cdp','chrome','browser'],'VERIFY','RESOURCE',false),
  tool('editor.vscode','VS Code Surface','Code','aura-ide','Inspect whether VS Code is actually observed by Remote Bridge and use the canonical JACO editor for the same repository.',['vscode','vs code','editor'],'VERIFY','RESOURCE',false),
  tool('chatgpt.connector','ChatGPT Connector','Collaboration','aura-ide','Inspect a real ChatGPT MCP/Workplace connector when one is registered; never infer it from an OpenAI model provider.',['chatgpt','openai connector','collaboration'],'VERIFY','RESOURCE',false),
  tool('evidence.receipts','Evidence & Receipts','Observability','aura-ide','Open mission receipts, verified progress, runtime evidence and blocked/unknown outcome truth.',['evidence','receipts','truth'],'VERIFY','RESOURCE',false),
  tool('terminal.open','Terminal','Runtime','aura-ide','Open the authorized local shell/npm/node/test execution surface with live verified output.',['shell','terminal','npm','node','test'],'ALLOW','VIEW',false),
];

export const findAuraProductTools = (query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return AURA_PRODUCT_TOOLS;
  return AURA_PRODUCT_TOOLS.filter(item =>
    [item.id,item.title,item.description,item.category,item.command,...item.aliases]
      .some(value => String(value).toLowerCase().includes(q))
  );
};
