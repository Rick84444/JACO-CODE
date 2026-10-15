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
  tool('mission.control','Mission Control','Missions','autopilot','Inspect and control autonomous execution and pending mission steps.',['autopilot','missions']),
  tool('notes.open','Notes','Collaboration','keep','Open the existing notes / Keep integration.',['keep','notes']),
  tool('system.harden','System Hardening','Security','hardening','Run hardening and security setup workflows.',['hardening','security'],'REVIEW','WORKFLOW'),
  tool('openclaw.open','OpenClaw','Connections','openclaw','Open OpenClaw integration and execution tools.',['openclaw','web']),
  tool('models.ollama','Ollama & Models','Models','models','Inspect, switch and pull local models.',['ollama','models']),
  tool('voice.intent','Voice & Intent','Collaboration','voice','Use voice input and inspect parsed agent intent.',['voice','speech']),
  tool('editor.legacy','Legacy Source Editor','Code','ide','Open the previous source editor while Monaco migration is in progress.',['code','source','editor']),
  tool('connections.devices','Device Connections','Connections','socket','Inspect paired sockets and devices.',['socket','devices']),
  tool('terminal.open','Terminal','Runtime','terminal','Open the authorized local shell/npm/node/test execution surface with live verified output.',['shell','terminal','npm','node','test'],'ALLOW'),
  tool('devices.android.setup','Android Setup','Devices','setup','Configure Android / Termux device integration.',['android','termux'],'REVIEW','WORKFLOW'),
  tool('compute.cuda.quantum','CUDA Quantum','Experimental','cuda-quantum','Open CUDA Quantum experimentation tools.',['cuda','quantum']),
  tool('models.litert','LiteRT-LM','Models','litert','Inspect or migrate LiteRT local inference.',['litert','npu']),
  tool('diagnostics.run','Diagnostics','Observability','diagnostics','Run connectivity and runtime diagnostics.',['ping','health'],'VERIFY','WORKFLOW'),
  tool('git.history','Patch History','Code','history','Inspect patch history and rollback / reapply operations.',['history','patch','git'],'REVIEW'),
  tool('system.intelligence','System Intelligence','Observability','intelligence','Inspect system intelligence and runtime state.',['intel','system']),
  tool('runtime.processes','Processes','Runtime','processes','Inspect active OS/runtime processes.',['processes','ps']),
  tool('bridge.antigravity','Antigravity Bridge','Connections','antigravity','Open Antigravity bridge and checkpoint tooling.',['bridge','antigravity']),
  tool('memory.inspect','Memory Store','Memory','memorystore','Inspect persistent memory store.',['memory','knowledge']),
  tool('economy.revenue','Revenue Intelligence','Economy','revenue','Inspect revenue and economic measurements.',['revenue','money']),
  tool('economy.checkout','Checkout','Economy','checkout','Open checkout/payment workflow.',['checkout','payment'],'REVIEW','WORKFLOW'),
  tool('capabilities.verified','Verified Capabilities','Marketplace','verified-capabilities','Inspect verified reusable capabilities.',['capabilities','skills']),
  tool('marketplaces.verified','Verified Marketplaces','Marketplace','verified-marketplaces','Inspect verified marketplaces and offers.',['marketplace','market']),
  tool('models.cost.route','Cost Orchestrator','Models','cost-orchestrator','Inspect cost-aware model routing.',['cost','routing']),
];

export const findAuraProductTools = (query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return AURA_PRODUCT_TOOLS;
  return AURA_PRODUCT_TOOLS.filter(item =>
    [item.id,item.title,item.description,item.category,item.command,...item.aliases]
      .some(value => String(value).toLowerCase().includes(q))
  );
};
