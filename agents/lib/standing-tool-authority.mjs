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
  const stateDir = path.join(workspaceRoot, '.jaco', 'state', 'autonomy');
  const file = path.join(stateDir, 'mandates.json');
  // The existing mandate store writes this marker on first initialization.
  // A missing file/record AFTER initialization must not resurrect legacy grants.
  const initialized = fs.existsSync(path.join(stateDir, 'bootstrap-initialized'));
  let records;
  try { records = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    return error?.code === 'ENOENT' && !initialized
      ? { status: 'LEGACY', allowed: false, reason: 'NO_MANDATE_STORE' }
      : { status: 'DENY', allowed: false, reason: 'MANDATE_STORE_MISSING_OR_UNREADABLE' };
  }
  if (!Array.isArray(records)) return { status: 'DENY', allowed: false, reason: 'MANDATE_STORE_INVALID' };
  const mandate = records.find(v => v?.id === STANDING_MANDATE_ID);
  if (!mandate) return initialized
    ? { status: 'DENY', allowed: false, reason: 'MANDATE_RECORD_MISSING' }
    : { status: 'LEGACY', allowed: false, reason: 'NO_STANDING_MANDATE' };
  // An unconfigured first-install placeholder is not a revocation: preserve
  // legacy behavior until the operator explicitly activates a mandate.
  // A previously signed, then revoked mandate must always deny.
  if (mandate.enabled === false && mandate.signedByOperator === false && !mandate.signedAt) {
    return { status: 'LEGACY', allowed: false, reason: 'MANDATE_NEVER_ACTIVATED' };
  }
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

// Existing CapabilityPolicy switches are explicit operator denies, not a
// competing source of grants. Read them at dispatch so live GUI edits apply.
export function operatorTaskEnabled(workspaceRoot, taskId) {
  if (!workspaceRoot || !taskId) return true;
  const file = path.join(workspaceRoot, '.jaco', 'state', 'capabilities.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { return error?.code === 'ENOENT'; }
  if (state?.schema !== 'jaco.capabilities/v1' || !Array.isArray(state.disabledTasks)) return false;
  return !state.disabledTasks.includes(taskId);
}

export function mcpAuthorityRoot(host) {
  // The MCP configuration resides at <workspace>/.jaco/mcp/servers.json.
  return typeof host?.configFile === 'string'
    ? path.resolve(path.dirname(host.configFile), '..', '..') : null;
}
