/**
 * JACO 0.17.1 — A2A and hands-off hardening verifier.
 *
 * Runs the real modules, not mocks, and writes an evidence file to
 * verification/a2a-hardening.json. Every assertion is an observation of the
 * running code; nothing is asserted that the run did not actually establish.
 *
 *   npm run test:a2a-hardening
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

import { A2AIdentityStore, canonicalJson } from '../src/server/a2a/identity.js';
import { runSkillInSandbox, analyseSkillSource } from '../src/server/a2a/skillSandbox.js';
import { blockedAddressReason, checkPeerUrl } from '../src/server/a2a/peerGuard.js';
import { SkillRegistry } from '../src/server/a2a/skillRegistry.js';
import { A2ATaskStore } from '../src/server/a2a/taskStore.js';
import { createA2ARouter } from '../src/server/a2a/router.js';
import { rateLimit, resetRateLimitState, securityHeaders } from '../src/server/security/httpHardening.js';

interface Check {
  id: string;
  claim: string;
  passed: boolean;
  observed: string;
}

const checks: Check[] = [];
let failures = 0;

function record(id: string, claim: string, passed: boolean, observed: string): void {
  checks.push({ id, claim, passed, observed });
  if (!passed) failures += 1;
  const label = passed ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${id} — ${claim}`);
  if (!passed) console.log(`        observed: ${observed}`);
}

async function main(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-a2a-verify-'));
  process.env.A2A_BEARER_TOKEN = 'verify-bearer-token-0123456789';
  process.env.GATEWAY_TOKEN = 'verify-gateway-token-0123456789';
  resetRateLimitState();

  // ── Identity ───────────────────────────────────────────────────────────────
  const identity = new A2AIdentityStore(workspace);
  const node = identity.get();
  record(
    'identity.ed25519',
    'node identity is an Ed25519 key pair, not a random string',
    node.keyAlgorithm === 'ed25519' && node.publicKeyPem.includes('BEGIN PUBLIC KEY'),
    `keyAlgorithm=${node.keyAlgorithm}`,
  );
  record(
    'identity.id-bound-to-key',
    'node id derives from the public key so a peer cannot claim another id',
    A2AIdentityStore.nodeIdMatchesKey(node.nodeId, node.publicKeyPem) &&
      !A2AIdentityStore.nodeIdMatchesKey('jaco-someone-else', node.publicKeyPem),
    `nodeId=${node.nodeId}`,
  );

  const payload = { hello: 'world', n: 7 };
  const signed = identity.signDetached(payload);
  record(
    'identity.signature-verifies',
    'a signed payload verifies, and a tampered payload does not',
    A2AIdentityStore.verifyDetached(payload, signed.signature, node.publicKeyPem) &&
      !A2AIdentityStore.verifyDetached({ ...payload, n: 8 }, signed.signature, node.publicKeyPem),
    `signature=${signed.signature.slice(0, 16)}…`,
  );
  record(
    'identity.private-key-never-exported',
    'the public identity object carries no private key',
    !Object.keys(node).some((key) => key.toLowerCase().includes('private')),
    `keys=${Object.keys(node).join(',')}`,
  );
  record(
    'identity.canonical-json-stable',
    'canonical JSON is key-order independent so both sides sign identical bytes',
    canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }),
    canonicalJson({ b: 1, a: 2 }),
  );

  // ── Sandbox ────────────────────────────────────────────────────────────────
  const escapes: Array<[string, string]> = [
    ['process.env exfiltration', 'function handler(){ return process.env; }'],
    ['module loader access', 'function handler(){ return require("fs").readdirSync("/"); }'],
    ['dynamic import', 'function handler(){ return import("node:fs"); }'],
    ['constructor realm walk', 'function handler(){ return this.constructor.constructor("return process.env")(); }'],
    ['eval', 'function handler(){ return eval("process.env"); }'],
    ['Function constructor', 'function handler(){ return new Function("return process")(); }'],
  ];
  for (const [label, code] of escapes) {
    const outcome = await runSkillInSandbox(code, {}, { timeoutMs: 1_500 });
    record(`sandbox.blocks.${label.replace(/\W+/g, '-')}`, `sandbox blocks ${label}`, outcome.success === false, `error=${outcome.error}`);
  }

  const ok = await runSkillInSandbox('function handler(p){ return { doubled: p.n * 2 }; }', { n: 21 }, { timeoutMs: 1_500 });
  record(
    'sandbox.executes-legitimate-skill',
    'a legitimate skill still runs and returns a checksummed result',
    ok.success && (ok.result as { doubled?: number })?.doubled === 42 && ok.checksum.length === 64,
    `result=${JSON.stringify(ok.result)} checksum=${ok.checksum.slice(0, 12)}…`,
  );

  const looper = await runSkillInSandbox('function handler(){ while(true){} }', {}, { timeoutMs: 800 });
  record(
    'sandbox.enforces-wall-clock',
    'an infinite loop is terminated instead of pinning the runtime',
    looper.success === false,
    `error=${looper.error}`,
  );

  const oversize = await runSkillInSandbox('function handler(){ return "x".repeat(400000); }', {}, { timeoutMs: 2_000, maxOutputBytes: 1_000 });
  record('sandbox.enforces-output-cap', 'oversized skill output is rejected', oversize.success === false, `error=${oversize.error}`);

  record(
    'sandbox.static-analysis',
    'static analysis flags escape indicators before execution',
    analyseSkillSource('function handler(){ return process.env; }').length > 0 &&
      analyseSkillSource('function handler(p){ return p.a + p.b; }').length === 0,
    `findings=${analyseSkillSource('function handler(){ return process.env; }').join(', ')}`,
  );

  // ── Peer guard ─────────────────────────────────────────────────────────────
  const blocked = ['169.254.169.254', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.9', '100.64.0.1'];
  const blockedResults = blocked.map((address) => blockedAddressReason(address, false));
  record(
    'peerguard.blocks-internal-ranges',
    'metadata, loopback, private and CGNAT addresses are refused',
    blockedResults.every((reason) => reason !== null),
    blocked.map((address, index) => `${address}: ${blockedResults[index] ?? 'ALLOWED'}`).join(' | '),
  );
  record(
    'peerguard.allows-public',
    'a publicly routable address is not blocked',
    blockedAddressReason('93.184.216.34', false) === null,
    '93.184.216.34 allowed',
  );
  record(
    'peerguard.blocks-ipv4-mapped-metadata',
    'IPv4-mapped IPv6 cannot smuggle a metadata address past the guard',
    blockedAddressReason('::ffff:169.254.169.254', false) !== null,
    String(blockedAddressReason('::ffff:169.254.169.254', false)),
  );

  const schemeCheck = await checkPeerUrl('file:///etc/passwd', {});
  record('peerguard.rejects-non-http', 'non-http schemes are refused', schemeCheck.allowed === false, String(schemeCheck.reason));
  const credCheck = await checkPeerUrl('https://user:pass@example.com', {});
  record('peerguard.rejects-embedded-credentials', 'URLs carrying credentials are refused', credCheck.allowed === false, String(credCheck.reason));
  const allowlistCheck = await checkPeerUrl('https://example.com', { allowedHosts: ['partner.test'] });
  record('peerguard.enforces-allowlist', 'a host outside the allowlist is refused', allowlistCheck.allowed === false, String(allowlistCheck.reason));

  // ── Skill trust model ──────────────────────────────────────────────────────
  const registry = new SkillRegistry(workspace, identity);
  const listing = registry.publishListing({ id: 'Test Skill!!', name: 'Test Skill', priceUsdc: 12.345, protocol: 'A2A v1.0' });
  record(
    'registry.listing-sanitised',
    'a published listing is id-normalised, price-rounded and signed',
    listing.id === 'test_skill__' && listing.priceUsdc === 12.35 && listing.listingSignature.length > 0,
    `id=${listing.id} price=${listing.priceUsdc}`,
  );
  record('registry.listing-not-executable', 'a listing alone is never executable', listing.executable === false, `executable=${listing.executable}`);

  const staged = registry.stagePackage({ id: 'peer_skill', code: 'function handler(){ return { ok: true }; }', authorNodeId: 'peer-node' });
  record('registry.staged-unverified', 'staged peer code lands UNVERIFIED', staged.trust === 'UNVERIFIED', `trust=${staged.trust}`);

  const refused = await registry.execute('peer_skill', {});
  record(
    'registry.unverified-cannot-run',
    'an UNVERIFIED package refuses to execute',
    refused.success === false && String(refused.error).includes('promote'),
    String(refused.error),
  );

  registry.promotePackage('peer_skill', 'VerifierOperator');
  const promoted = await registry.execute('peer_skill', {});
  record('registry.promoted-runs', 'an operator-promoted package executes', promoted.success === true, JSON.stringify(promoted.result));

  fs.writeFileSync(path.join(workspace, '.jaco', 'skills', 'peer_skill', 'index.js'), 'function handler(){ return { tampered: true }; }', 'utf8');
  const tampered = await registry.execute('peer_skill', {});
  record(
    'registry.checksum-drift-quarantines',
    'code edited after promotion is quarantined instead of executed',
    tampered.success === false && registry.listPackages().find((pkg) => pkg.id === 'peer_skill')?.trust === 'QUARANTINED',
    String(tampered.error),
  );

  const builtin = await registry.execute('code-review-audit', { code: 'const x = eval("1"); process.env.SECRET;' });
  record(
    'registry.builtin-audit-runs',
    'the built-in code audit capability returns observed findings',
    builtin.success === true && Array.isArray((builtin.result as { issues?: unknown[] })?.issues),
    JSON.stringify(builtin.result).slice(0, 120),
  );

  // ── Task ledger ────────────────────────────────────────────────────────────
  const store = new A2ATaskStore(workspace);
  store.create({ id: 'task-1', skill: 'code-review-audit', params: {}, requesterNodeId: 'peer', responderNodeId: node.nodeId, idempotencyKey: 'key-1' });
  record('tasks.idempotency-hit', 'a repeated task id with the same key returns the original task', store.findIdempotent('task-1', 'key-1') !== undefined, 'replay returned the original');
  record('tasks.idempotency-miss', 'a repeated task id with different parameters is not treated as a replay', store.findIdempotent('task-1', 'key-2') === undefined, 'different key rejected');
  store.transition('task-1', 'completed', 'done');
  store.transition('task-1', 'working', 'late worker result');
  record('tasks.terminal-is-final', 'a completed task cannot be reopened by a late worker', store.get('task-1')?.status.state === 'completed', `state=${store.get('task-1')?.status.state}`);
  let rejectedId = false;
  try {
    A2ATaskStore.validateTaskId('../../etc/passwd');
  } catch {
    rejectedId = true;
  }
  record('tasks.id-validation', 'a traversal-shaped task id is refused', rejectedId, 'validateTaskId threw');

  // ── HTTP surface ───────────────────────────────────────────────────────────
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders({ httpsOnly: true }));
  app.use(express.json({ limit: '2mb' }));
  // The global limiter is exercised on its own app below; here it stays wide so
  // it cannot mask a functional failure in the routes under test.
  app.use(rateLimit({ windowMs: 60_000, max: 10_000 }, 'verify-suite'));
  const requireMutationAuth: express.RequestHandler = (req, res, next) => {
    const provided = String(req.headers['x-gateway-token'] || '');
    if (provided !== process.env.GATEWAY_TOKEN) return res.status(401).json({ success: false, error: 'gateway authentication required' });
    next();
  };
  app.use(createA2ARouter({ workspaceRoot: workspace, host: '0.0.0.0', version: '0.17.1-verify', requireMutationAuth }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const cardResponse = await fetch(`${base}/.well-known/agent.json`);
    const card = (await cardResponse.json()) as Record<string, unknown>;
    const { signature, signatureAlgorithm, signedAt, publicKeyPem, ...signedBody } = card;
    record(
      'http.agent-card-signed',
      'the published agent card carries a signature that verifies against its own key',
      A2AIdentityStore.verifyDetached(signedBody, String(signature), String(publicKeyPem)),
      `nodeId=${card.nodeId}`,
    );
    record(
      'http.agent-card-no-false-verification',
      'the card never asserts that a peer is verified',
      card.verifiedPeerStatus === false,
      `verifiedPeerStatus=${card.verifiedPeerStatus}`,
    );
    record(
      'http.security-headers',
      'security headers are present on every response',
      cardResponse.headers.get('content-security-policy') !== null &&
        cardResponse.headers.get('x-content-type-options') === 'nosniff' &&
        cardResponse.headers.get('x-frame-options') === 'DENY',
      `csp=${String(cardResponse.headers.get('content-security-policy')).slice(0, 40)}…`,
    );

    const unauth = await fetch(`${base}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/list', params: {} }),
    });
    record('http.rpc-requires-bearer', 'the JSON-RPC endpoint refuses an unauthenticated peer', unauth.status === 401, `status=${unauth.status}`);

    const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${process.env.A2A_BEARER_TOKEN}` };
    const send = await fetch(`${base}/a2a`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/send',
        params: { id: 'verify-task-1', skill: 'code-review-audit', message: { parts: [{ type: 'data', data: { code: 'const a = eval("1");' } }] } },
      }),
    });
    const sendBody = (await send.json()) as { result?: { id?: string; status?: { state?: string } } };
    record(
      'http.rpc-executes-skill',
      'an authenticated tasks/send executes a skill and completes the task',
      send.status === 200 && sendBody.result?.status?.state === 'completed',
      `state=${sendBody.result?.status?.state}`,
    );

    const replay = await fetch(`${base}/a2a`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tasks/send',
        params: { id: 'verify-task-1', skill: 'code-review-audit', message: { parts: [{ type: 'data', data: { code: 'const a = eval("1");' } }] } },
      }),
    });
    const replayBody = (await replay.json()) as { result?: { idempotentReplay?: boolean } };
    record('http.rpc-idempotent', 'a retried tasks/send is served from the ledger instead of executing twice', replayBody.result?.idempotentReplay === true, `idempotentReplay=${replayBody.result?.idempotentReplay}`);

    const nonceHeaders = { ...authHeaders, 'x-a2a-nonce': 'verify-nonce-abc123', 'x-a2a-timestamp': new Date().toISOString() };
    const firstNonce = await fetch(`${base}/a2a`, { method: 'POST', headers: nonceHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tasks/list', params: {} }) });
    const secondNonce = await fetch(`${base}/a2a`, { method: 'POST', headers: nonceHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tasks/list', params: {} }) });
    record('http.replay-protection', 'a reused nonce is refused', firstNonce.status === 200 && secondNonce.status === 409, `first=${firstNonce.status} second=${secondNonce.status}`);

    const staleTimestamp = await fetch(`${base}/a2a`, {
      method: 'POST',
      headers: { ...authHeaders, 'x-a2a-nonce': 'verify-nonce-stale1', 'x-a2a-timestamp': new Date(Date.now() - 3_600_000).toISOString() },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tasks/list', params: {} }),
    });
    record('http.replay-window', 'a timestamp outside the replay window is refused', staleTimestamp.status === 401, `status=${staleTimestamp.status}`);

    const publishUnauth = await fetch(`${base}/api/a2a/publish-skill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', name: 'X' }),
    });
    record('http.publish-requires-gateway-token', 'publishing a listing requires the gateway token', publishUnauth.status === 401, `status=${publishUnauth.status}`);

    const ssrf = await fetch(`${base}/api/a2a/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-token': String(process.env.GATEWAY_TOKEN) },
      body: JSON.stringify({ targetEndpoint: 'http://169.254.169.254/latest/meta-data/' }),
    });
    const ssrfBody = (await ssrf.json()) as { report?: { overallStatus?: string; diagnosticLog?: string[] } };
    record(
      'http.handshake-blocks-metadata-ssrf',
      'a handshake aimed at the cloud metadata endpoint is refused by the guard',
      ssrfBody.report?.overallStatus === 'unreachable' && (ssrfBody.report?.diagnosticLog || []).some((line) => line.includes('FAILED')),
      (ssrfBody.report?.diagnosticLog || []).join(' | ').slice(0, 160),
    );

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Limiter proven on a dedicated app so a tight budget cannot mask a functional
  // failure in the routes above.
  {
    resetRateLimitState();
    const limiterApp = express();
    limiterApp.use(rateLimit({ windowMs: 60_000, max: 3 }, 'verify-limiter'));
    limiterApp.get('/ping', (_req, res) => res.json({ ok: true }));
    const limiterServer = limiterApp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => limiterServer.once('listening', () => resolve()));
    const limiterPort = (limiterServer.address() as AddressInfo).port;

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${limiterPort}/ping`);
      statuses.push(response.status);
    }
    const limited = statuses.filter((status) => status === 429).length;
    record(
      'http.rate-limit-engages',
      'the limiter allows the budget and returns 429 for the rest of the window',
      statuses.slice(0, 3).every((status) => status === 200) && limited === 3,
      `statuses=${statuses.join(',')}`,
    );
    await new Promise<void>((resolve) => limiterServer.close(() => resolve()));
  }

  // ── Hands-off queue durability ─────────────────────────────────────────────
  // jobQueue resolves its storage directory at module load from process.cwd(),
  // so the module is imported only after chdir into the throwaway workspace.
  // The real .jaco/job_queue.json of this checkout is never touched.
  {
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const queue = await import('../src/server/queue/jobQueue.js');
      const { reapStaleJobs } = await import('../src/server/queue/jobReaper.js');

      const job = queue.enqueue({ type: 'quality_audit', payload: { targetDir: '.' }, description: 'reaper fixture', riskLevel: 'LOW' });
      const claimed = queue.claimNext('worker-that-will-die', ['quality_audit']);
      record('queue.claim-succeeds', 'a queued job can be claimed by a worker', claimed?.id === job.id, `claimed=${claimed?.id}`);

      const fresh = reapStaleJobs({ leaseMs: 600_000 });
      record(
        'queue.reaper-respects-lease',
        'a job inside its lease is left alone',
        fresh.reclaimed.length === 0 && fresh.inspected === 1,
        `inspected=${fresh.inspected} reclaimed=${fresh.reclaimed.length}`,
      );

      // Simulate the worker dying: the claim is now older than the lease.
      const expired = reapStaleJobs({ leaseMs: 0 });
      const after = queue.getJob(job.id);
      record(
        'queue.reaper-reclaims-dead-worker',
        'a claim abandoned by a dead worker is returned to the queue instead of stalling forever',
        expired.reclaimed.length === 1 && after?.status === 'queued' && (after?.retryCount ?? 0) === 1,
        `status=${after?.status} retryCount=${after?.retryCount}`,
      );

      // Retry budget still bounds a poison job.
      queue.claimNext('worker-2', ['quality_audit']);
      reapStaleJobs({ leaseMs: 0 });
      queue.claimNext('worker-3', ['quality_audit']);
      reapStaleJobs({ leaseMs: 0 });
      const exhausted = queue.getJob(job.id);
      record(
        'queue.reaper-honours-retry-budget',
        'a job that keeps stalling fails instead of looping forever',
        exhausted?.status === 'failed',
        `status=${exhausted?.status} retryCount=${exhausted?.retryCount}`,
      );
    } finally {
      process.chdir(previousCwd);
    }
  }

  // ── Evidence ───────────────────────────────────────────────────────────────
  const report = {
    suite: 'a2a-hands-off-hardening',
    version: '0.17.1',
    evidenceState: 'OBSERVED',
    observedAt: new Date().toISOString(),
    node: { platform: process.platform, node: process.version },
    total: checks.length,
    passed: checks.length - failures,
    failed: failures,
    checks,
  };

  const outputDir = path.join(process.cwd(), 'verification');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'a2a-hardening.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log(`A2A hardening: ${report.passed}/${report.total} checks passed`);
  console.log(`evidence: verification/a2a-hardening.json`);

  fs.rmSync(workspace, { recursive: true, force: true });
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[verify_a2a_hardening] suite failed to run:', error);
  process.exitCode = 1;
});
