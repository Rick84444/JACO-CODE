// The single Aura chat uses the existing MCP host and policy authority.
// Discovery may start an already configured server, but never executes a tool.
import { agentRefusal, isReadOnlyTool, resolveAdvertisedTool } from './stdioMcpHost.mjs';
import { operatorApprovalCheck } from '../../../../agents/lib/operator-action-guard.mjs';
import { standingToolAuthority, mcpAuthorityRoot } from '../../../../agents/lib/standing-tool-authority.mjs';

const SERVER = /^[a-z][a-z0-9-]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,120}$/;

function configured(host, server) {
  if (!SERVER.test(server)) throw Error('MCP_SERVER_ID_INVALID');
  const def = host.servers()[server];
  if (!def || def.validationError) throw Error('MCP_SERVER_UNAVAILABLE');
  if (def.agentAccess === 'off') throw Error('MCP_AGENT_ACCESS_OFF');
  return def;
}
export async function discoverAuraMcpTools(host, server) {
  configured(host, server);
  const tools = await host.listTools(server);
  const def = configured(host, server);
  return {
    server, access: def.agentAccess,
    // Discovery does not imply readiness to act or permission for a particular input.
    tools: tools.slice(0, 150).map(tool => ({
      name: tool.name, description: String(tool.description || '').slice(0, 500), inputSchema: tool.inputSchema,
      readOnly: isReadOnlyTool(server, tool), denied: def.deny?.includes(tool.name) === true
    }))
  };
}
export async function callAuraMcpTool(host, { server, tool, args = {}, mode = 'read' }) {
  let def = configured(host, server);
  if (!TOOL.test(tool)) throw Error('MCP_TOOL_ID_INVALID');
  if (mode !== 'read' && mode !== 'write') throw Error('MCP_MODE_INVALID');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('MCP_ARGUMENTS_INVALID');
  if (def.deny?.includes(tool)) throw Error('MCP_TOOL_DENIED');
  // This starts a configured but stopped server; status READY is not a
  // prerequisite. Never start an "off" server or widen its access level.
  const tools = await host.listTools(server);
  def = configured(host, server);
  const advertised = resolveAdvertisedTool(server, tool, tools);
  if (!advertised) throw Error('MCP_TOOL_UNAVAILABLE');
  tool = advertised.name;
  const readOnly = isReadOnlyTool(server, advertised);
  const localWorkspaceTool = ['shell', 'filesystem', 'git'].includes(server);
  const consequence = readOnly ? 'READ'
    : server === 'git' && /push|merge|release|publish/i.test(tool) ? 'PUBLISH'
    : localWorkspaceTool ? 'LOCAL_MUTATION' : 'EXTERNAL_MUTATION';
  const authority = standingToolAuthority(mcpAuthorityRoot(host), consequence);
  if (authority.status === 'DENY' || authority.status === 'REVIEW') throw Error('MCP_STANDING_MANDATE_' + authority.status);
  const refusal = agentRefusal(def, advertised, args, {
    allowRemoteWrite: consequence === 'EXTERNAL_MUTATION' && authority.allowed
  });
  if (refusal) throw Error(refusal);
  if (mode === 'read' && !readOnly) throw Error('MCP_TOOL_WRITE_MODE_REQUIRED');
  if (mode === 'write' && !readOnly) {
    // Local, workspace-bound MCP writes inherit the operator's standing
    // authority. No separate chat microapproval may override an explicit ALLOW.
    // Outward and unknown-effect tools still follow their existing scope gates.
    if (!authority.allowed) {
      const required = operatorApprovalCheck({type:'mcp-write',data:{server,tool}});
      if (required) throw Error('MCP_MISSION_APPROVAL_REQUIRED');
    }
  }
  return host.call(server, tool, args, { actor:'agent', readOnly: mode === 'read' });
}


// Shared public research route; no browser, no credentials and no unrestricted
// server-side fetch. The MCP host still enforces operator off/deny switches.
export async function readPublicViaMcp(host, url) {
  const result = await callAuraMcpTool(host, {server:'fetch', tool:'fetch', args:{url}, mode:'read'});
  const content = (result?.content || []).filter(x => x.type === 'text').map(x => String(x.text || '')).join('\n');
  if (result?.isError === true) throw Error(content.slice(0, 240) || 'PUBLIC_FETCH_FAILED');
  if (!content) throw Error('PUBLIC_FETCH_EMPTY');
  return content;
}

export function githubRepoFromRemote(remote) {
  const match = String(remote || '').trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return match?.[1] || null;
}

/** @param {any} host @param {{repository?: string, number?: number, page?: number, section?: string}} [options] */
export async function readGithubPullRequest(host, {repository, number, page = 1, section = 'summary'} = {}) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) ||
      repository.split('/').some(v => v === '.' || v === '..') ||
      !Number.isSafeInteger(number) || number < 1 ||
      !Number.isSafeInteger(page) || page < 1 || page > 100 ||
      !['summary','files','commits'].includes(section)) throw Error('GITHUB_PR_ARGUMENTS_INVALID');
  const endpoint = 'https://api.github.com/repos/' + repository + '/pulls/' + number;
  const url = section === 'summary' ? endpoint : endpoint + '/' + section + '?per_page=10&page=' + page;
  const raw = await readPublicViaMcp(host, url);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Error('GITHUB_PR_RESPONSE_TRUNCATED_OR_INVALID: request a narrower file or page'); }
  if (section !== 'summary' && !Array.isArray(parsed)) throw Error('GITHUB_PR_RESPONSE_INVALID');
  if (section === 'summary' && (!parsed || parsed.number !== number || !parsed.head?.sha)) throw Error('GITHUB_PR_RESPONSE_INVALID');
  if (section === 'summary') return {source:url,number,title:parsed.title,state:parsed.state,headSha:parsed.head.sha,baseSha:parsed.base?.sha,changedFiles:parsed.changed_files,body:String(parsed.body||'').slice(0,6000)};
  const records = parsed.map(v=>section==='files'?{filename:v.filename,status:v.status,additions:v.additions,deletions:v.deletions,patch:typeof v.patch==='string'?v.patch.slice(0,2000):null,patchIncomplete:typeof v.patch!=='string'||v.patch.length>2000}:{sha:v.sha,message:String(v.commit?.message||'').slice(0,400)});
  return {source:url,section,page,records,mayHaveMore:parsed.length===10,note:'Paginated public data; omitted or truncated patches are not full review evidence.'};
}
