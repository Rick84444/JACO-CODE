#!/usr/bin/env node

/**
 * Target-machine acceptance probe for the canonical JACO Autonomous IDE.
 *
 * This script deliberately checks only observable behavior. It does not turn
 * UNOBSERVED integrations into PASS and it does not enable mutation gates.
 *
 * Default mode proves the local workbench contract and performs a reversible
 * temporary-file lifecycle. --strict-product additionally requires the live
 * physical integration surfaces requested for the full operator product:
 * Remote ready, a real CDP target, an observed VS Code window and an observed
 * ChatGPT MCP/Workplace client session.
 */

import process from 'node:process';

const BASE = String(process.env.JACO_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const STRICT = process.argv.includes('--strict-product');
const TOKEN = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';

const checks = [];
const record = (name, state, detail, evidence = null) => {
  checks.push({ name, state, detail, evidence });
  const mark = state === 'PASS' ? 'PASS' : state === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL';
  console.log(`${mark.padEnd(8)} ${name.padEnd(30)} ${detail}`);
};

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, 'x-gateway-token': TOKEN } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({ error: `HTTP_${response.status}` }));
  if (!response.ok || body?.success === false) {
    const error = new Error(body?.error || `HTTP_${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

const stateOf = value => String(value || 'UNOBSERVED').toUpperCase();
const requireStrict = (name, ok, detail, evidence = null) => {
  if (ok) record(name, 'PASS', detail, evidence);
  else record(name, STRICT ? 'BLOCKED' : 'PARTIAL', detail, evidence);
};

let snapshot = null;
let tempPath = null;
let renamedPath = null;
let tempHash = null;

try {
  snapshot = await request('/api/aura/workbench');
  record(
    'Aura workbench API',
    snapshot?.schema === 'jaco.aura-workbench/v1' ? 'PASS' : 'BLOCKED',
    snapshot?.schema || 'unexpected schema',
    { observedAt: snapshot?.observedAt || null },
  );

  const files = await request('/api/aura/workbench/files');
  const fileRows = Array.isArray(files?.files) ? files.files : [];
  record('Recursive file source', fileRows.length > 0 ? 'PASS' : 'BLOCKED', `${fileRows.length} text file(s) observed`);

  const rootTree = await request('/api/aura/workbench/tree');
  const rootEntries = Array.isArray(rootTree?.entries) ? rootTree.entries : [];
  const rootFolder = rootEntries.find(entry => entry?.kind === 'directory');
  if (!rootEntries.length) throw new Error('WORKBENCH_TREE_EMPTY');
  if (rootFolder) {
    const nestedTree = await request(`/api/aura/workbench/tree?path=${encodeURIComponent(rootFolder.path)}`);
    if (!Array.isArray(nestedTree?.entries)) throw new Error('WORKBENCH_TREE_NESTED_INVALID');
  }
  record('Lazy directory API', 'PASS', `${rootEntries.length} root entries; nested directory fetch verified`);

  const stamp = `${Date.now()}-${process.pid}`;
  tempPath = `tmp/jaco-aura-acceptance-${stamp}.txt`;
  renamedPath = `tmp/jaco-aura-acceptance-${stamp}-renamed.txt`;
  const payload = `JACO_AURA_ACCEPTANCE ${new Date().toISOString()}\n`;

  const created = await request('/api/aura/workbench/file', {
    method: 'PUT',
    body: JSON.stringify({ path: tempPath, content: payload }),
  });
  tempHash = created.hash;
  const readBack = await request(`/api/aura/workbench/file?path=${encodeURIComponent(tempPath)}`);
  if (readBack.content !== payload || readBack.hash !== tempHash) throw new Error('CREATE_READBACK_MISMATCH');
  record('File create/read', 'PASS', 'temporary file readback hash matched', { path: tempPath, hash: tempHash });

  const renamed = await request('/api/aura/workbench/file/rename', {
    method: 'POST',
    body: JSON.stringify({ from: tempPath, to: renamedPath, expectedHash: tempHash }),
  });
  tempPath = null;
  tempHash = renamed.hash;
  const renamedRead = await request(`/api/aura/workbench/file?path=${encodeURIComponent(renamedPath)}`);
  if (renamedRead.hash !== tempHash) throw new Error('RENAME_READBACK_MISMATCH');
  record('File rename', 'PASS', 'renamed file hash matched', { path: renamedPath, hash: tempHash });

  await request('/api/aura/workbench/file/delete', {
    method: 'POST',
    body: JSON.stringify({ path: renamedPath, expectedHash: tempHash }),
  });
  renamedPath = null;
  record('File delete', 'PASS', 'temporary file removed with expected-hash guard');

  const git = snapshot?.git || {};
  requireStrict(
    'Git repository',
    git.available === true,
    git.available ? `${git.branch || 'detached'}${git.tracking ? ` → ${git.tracking}` : ''}; ↑${git.ahead || 0} ↓${git.behind || 0}` : (git.error || 'Git unavailable'),
    git.available ? { branch: git.branch, tracking: git.tracking, dirty: git.dirty } : null,
  );

  const mcp = snapshot?.mcp || {};
  const providers = Array.isArray(mcp.providers) ? mcp.providers : [];
  const remote = snapshot?.integrations?.remote || {};
  const cdp = snapshot?.integrations?.cdp || {};
  const vscode = snapshot?.integrations?.vscode || {};
  const chatgpt = snapshot?.integrations?.chatgpt || {};

  record('MCP provider catalog', providers.length >= 2 ? 'PASS' : 'PARTIAL', `${providers.length} provider(s) observed`);
  requireStrict(
    'Remote / Desktop',
    stateOf(remote.state) === 'VERIFIED' && remote.ready === true,
    `${stateOf(remote.state)}; bridge=${remote.bridge || 'UNOBSERVED'}; windows=${remote.windowsObserved || 0}`,
    remote,
  );
  requireStrict(
    'Chrome CDP',
    stateOf(cdp.state) === 'VERIFIED' && Number(cdp.targetCount || 0) > 0,
    `${stateOf(cdp.state)}; bridge=${cdp.bridge || 'UNOBSERVED'}; targets=${cdp.targetCount || 0}`,
    cdp,
  );
  requireStrict(
    'VS Code live surface',
    stateOf(vscode.state) === 'OBSERVED' && Number(vscode.windowCount || 0) > 0,
    `${stateOf(vscode.state)}; mcpConfigured=${Boolean(vscode.mcpConfigured)}; windows=${vscode.windowCount || 0}`,
    vscode,
  );
  requireStrict(
    'ChatGPT client session',
    stateOf(chatgpt.state) === 'OBSERVED',
    `${stateOf(chatgpt.state)}; gatewayConfigured=${Boolean(chatgpt.gatewayConfigured)}; ${chatgpt.note || ''}`,
    chatgpt,
  );

  requireStrict(
    'Workplace',
    snapshot?.workplace?.reachable === true,
    snapshot?.workplace?.reachable ? snapshot.workplace.status : (snapshot?.workplace?.error || 'not reachable'),
    snapshot?.workplace || null,
  );
  requireStrict(
    'Canonical runtime',
    snapshot?.runtime?.running === true,
    snapshot?.runtime?.running ? 'running' : 'runtime not observed running',
    { workers: snapshot?.runtime?.workers?.length || 0 },
  );

  const falseCompletion = snapshot?.mission?.status === 'DONE'
    && !Array.isArray(snapshot?.mission?.receipts);
  record(
    'Completion truth guard',
    falseCompletion ? 'BLOCKED' : 'PASS',
    falseCompletion ? 'DONE mission lacked receipt projection' : 'no unsupported completion observed',
  );
} catch (error) {
  record('Acceptance execution', 'BLOCKED', error?.message || String(error), error?.body || null);
} finally {
  // Best-effort cleanup only for files created by this process.
  const cleanup = async (path, hash) => {
    if (!path || !hash) return;
    try {
      await request('/api/aura/workbench/file/delete', {
        method: 'POST',
        body: JSON.stringify({ path, expectedHash: hash }),
      });
      console.log(`CLEANUP  ${path}`);
    } catch (error) {
      console.error(`CLEANUP_BLOCKED ${path}: ${error?.message || error}`);
    }
  };
  await cleanup(renamedPath, tempHash);
  await cleanup(tempPath, tempHash);
}

const blocked = checks.filter(check => check.state === 'BLOCKED');
const partial = checks.filter(check => check.state === 'PARTIAL');
const report = {
  schema: 'jaco.aura-operator-acceptance/v1',
  observedAt: new Date().toISOString(),
  baseUrl: BASE,
  strictProduct: STRICT,
  result: blocked.length ? 'BLOCKED' : partial.length ? 'PARTIAL' : 'PASS',
  counts: { pass: checks.filter(check => check.state === 'PASS').length, partial: partial.length, blocked: blocked.length },
  checks,
};
console.log('\n' + JSON.stringify(report, null, 2));
process.exitCode = blocked.length ? 1 : 0;
