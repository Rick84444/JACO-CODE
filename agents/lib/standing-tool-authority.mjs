// Read the operator's EXISTING standing mandate for tool execution.
// This is an adapter, not another policy store. It never creates or signs grants.
// Missing legacy stores retain legacy controls; damaged/revoked records cannot authorize work.
import fs from 'node:fs';
import path from 'node:path';

const CLASSES = new Set(['READ','LOCAL_MUTATION','EXTERNAL_MUTATION','PUBLISH','FINANCIAL','AUTH','SECURITY','DESTRUCTIVE']);
export const STANDING_MANDATE_ID = 'operator-level5-default';

export function standingToolAuthority(workspaceRoot, consequence, {now = Date.now()} = {}) {
  if (!CLASSES.has(consequence)) throw Error('MANDATE_CONSEQUENCE_INVALID');
  if (!workspaceRoot) return { status: 'LEGACY', allowed: false, reason: 'WORKSPACE_UNKNOWN' };
  const file = path.join(workspaceRoot, '.jaco', 'state', 'autonomy', 'mandates.json');
  let records;
  try { records = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'LEGACY', allowed: false, reason: 'NO_MANDATE_STORE' }
      : { status: 'DENY', allowed: false, reason: 'MANDATE_STORE_UNREADABLE' };
  }
  if (!Array.isArray(records)) return { status: 'DENY', allowed: false, reason: 'MANDATE_STORE_INVALID' };
  const mandate = records.find(v => v?.id === STANDING_MANDATE_ID);
  if (!mandate) return { status: 'LEGACY', allowed: false, reason: 'NO_STANDING_MANDATE' };
  const valid = mandate.enabled === true && mandate.signedByOperator === true
    && ((mandate.validity === 'STANDING' && mandate.expiresAt === null)
      || (typeof mandate.expiresAt === 'string' && Number.isFinite(Date.parse(mandate.expiresAt))
        && Date.parse(mandate.expiresAt) > now));
  if (!valid) return { status: 'DENY', allowed: false, reason: 'MANDATE_INACTIVE_OR_REVOKED' };
  const raw = mandate.decisions?.[consequence];
  if (!['ALLOW','REVIEW','DENY'].includes(raw)) return { status: 'DENY', allowed: false, reason: 'MANDATE_DECISION_INVALID' };
  // Follow the existing AutonomyMandateStore financial invariant.
  const decision = consequence === 'FINANCIAL' && raw !== 'DENY' ? 'REVIEW' : raw;
  return { status: decision, allowed: decision === 'ALLOW', revision: mandate.revision ?? 1,
    reason: decision === 'ALLOW' ? 'OPERATOR_STANDING_MANDATE' : 'OPERATOR_MANDATE_' + decision };
}

export function mcpAuthorityRoot(host) {
  // The MCP configuration resides at <workspace>/.jaco/mcp/servers.json.
  return typeof host?.configFile === 'string'
    ? path.resolve(path.dirname(host.configFile), '..', '..') : null;
}
