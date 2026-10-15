import crypto from 'node:crypto';
import express from 'express';
import { A2AIdentityStore } from './identity.js';
import { SkillRegistry } from './skillRegistry.js';
import { A2ATaskStore, type A2ATask } from './taskStore.js';
import { A2AScraperService } from './scraperService.js';
import { checkPeerUrl, guardedPeerFetch, parsePeerHostAllowlist, type PeerGuardOptions } from './peerGuard.js';
import { isLoopbackHost, rateLimit } from '../security/httpHardening.js';

/**
 * A2A surface.
 *
 * Every route here already had a caller in the shipped GUI — A2ADiagnostics and
 * A2AWorkflowDashboard call `/api/a2a/handshake`, `/api/a2a/publish-skill`,
 * `/api/a2a/tasks`, `/api/a2a/scraper/*`, `/.well-known/agent.json` and the
 * JSON-RPC endpoint at `/a2a`. In 0.17 none of them existed on the server, so
 * the dashboard rendered against a 404 wall. This router serves exactly those
 * contracts, so no GUI file changes.
 *
 * Authentication model:
 *  - agent card discovery is public, because that is what discovery means, and
 *    rate limited so it cannot be used as an amplifier;
 *  - the JSON-RPC endpoint requires the peer bearer token whenever one is
 *    configured or the runtime is bound beyond loopback — a peer that can reach
 *    it can spend this node's compute;
 *  - the operator routes reuse the runtime's existing gateway-token handler, so
 *    there is one authority for mutations rather than a second scheme.
 */

export interface A2ARouterDependencies {
  workspaceRoot: string;
  host: string;
  version: string;
  requireMutationAuth: express.RequestHandler;
  onEvent?: (event: { actor: string; type: string; message: string; verified: boolean }) => void;
}

interface NonceRecord {
  seenAt: number;
}

const NONCE_TTL_MS = 5 * 60_000;
const MAX_NONCES = 10_000;
const nonces = new Map<string, NonceRecord>();

function rememberNonce(nonce: string): boolean {
  const now = Date.now();
  if (nonces.size > MAX_NONCES) {
    for (const [key, record] of nonces) if (now - record.seenAt > NONCE_TTL_MS) nonces.delete(key);
  }
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, { seenAt: now });
  return true;
}

function timingSafeEquals(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createA2ARouter(deps: A2ARouterDependencies): express.Router {
  const router = express.Router();
  const identity = new A2AIdentityStore(deps.workspaceRoot);
  const skills = new SkillRegistry(deps.workspaceRoot, identity);
  const tasks = new A2ATaskStore(deps.workspaceRoot);

  const guardOptions = (): PeerGuardOptions => ({
    allowLoopback: process.env.JACO_A2A_ALLOW_LOOPBACK_PEERS === 'true' || isLoopbackHost(deps.host),
    allowedHosts: parsePeerHostAllowlist(process.env.JACO_A2A_PEER_HOSTS),
    timeoutMs: Number(process.env.JACO_A2A_PEER_TIMEOUT_MS || 8_000),
  });

  const scraper = new A2AScraperService(deps.workspaceRoot, guardOptions);
  scraper.applySchedule();

  const emit = (type: string, message: string, verified: boolean) =>
    deps.onEvent?.({ actor: 'A2A', type, message: message.slice(0, 300), verified });

  /** Peer authentication for machine-to-machine traffic. */
  const requirePeerAuth: express.RequestHandler = (req, res, next) => {
    const expected = String(process.env.A2A_BEARER_TOKEN || '').trim();
    const loopbackOnly = isLoopbackHost(deps.host);

    if (!expected) {
      if (loopbackOnly) return next();
      return res.status(503).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'A2A_BEARER_TOKEN is required before the A2A endpoint may be exposed beyond loopback' },
      });
    }

    const header = String(req.headers.authorization || '');
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!provided || !timingSafeEquals(provided, expected)) {
      emit('a2a.auth.rejected', `unauthenticated A2A call to ${req.path}`, true);
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'A2A bearer authentication required' } });
    }

    // Replay window. Optional for backwards compatibility with peers that do not
    // send the headers, enforced strictly once they do.
    const nonce = String(req.headers['x-a2a-nonce'] || '');
    const timestamp = String(req.headers['x-a2a-timestamp'] || '');
    if (nonce || timestamp) {
      const sent = Date.parse(timestamp);
      if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > NONCE_TTL_MS) {
        return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'x-a2a-timestamp is missing or outside the 5 minute replay window' } });
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce) || !rememberNonce(nonce)) {
        return res.status(409).json({ jsonrpc: '2.0', id: null, error: { code: -32004, message: 'x-a2a-nonce is malformed or has already been used' } });
      }
    }
    next();
  };

  const discoveryLimit = rateLimit({ windowMs: 60_000, max: 120 }, 'a2a-discovery');
  const invokeLimit = rateLimit({ windowMs: 60_000, max: 60 }, 'a2a-invoke');
  const outboundLimit = rateLimit({ windowMs: 60_000, max: 20 }, 'a2a-outbound');

  // ─────────────────────────────────────────────────────────────────────────
  // Discovery: signed agent card in the shape the dashboard already parses.
  // ─────────────────────────────────────────────────────────────────────────
  const agentCard = (req: express.Request) => {
    const node = identity.get();
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers.host || `${deps.host}`);
    const url = `${proto}://${host}`;

    const card = {
      name: node.name,
      version: deps.version,
      description: 'JACO Cognitive IDE autonomous node. Skills execute under an operator-gated trust model.',
      url,
      protocolVersion: '1.0.0',
      nodeId: node.nodeId,
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      skills: skills.listListings().map((listing) => ({
        id: listing.id,
        name: listing.name,
        description: listing.description,
        inputModes: ['data'],
        outputModes: ['data'],
        priceUsdc: listing.priceUsdc,
        executable: listing.executable,
        trust: listing.trust,
      })),
      capabilityDigest: skills.capabilityDigest(),
      // Peer verification is a claim about the *other* side and is never asserted here.
      verifiedPeerStatus: false,
      evidenceState: 'OBSERVED' as const,
      observedAt: new Date().toISOString(),
    };

    const { signature, algorithm, signedAt } = identity.signDetached(card);
    return { ...card, signature, signatureAlgorithm: algorithm, signedAt, publicKeyPem: node.publicKeyPem };
  };

  router.get('/.well-known/agent.json', discoveryLimit, (req, res) => {
    res.type('application/json').json(agentCard(req));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // JSON-RPC: tasks/send, tasks/list, tasks/cancel
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/a2a', invokeLimit, requirePeerAuth, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = body.id ?? null;
    const method = String(body.method || '');
    const params = (body.params ?? {}) as Record<string, unknown>;

    const fail = (code: number, message: string, status = 400) =>
      res.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });

    if (body.jsonrpc !== '2.0') return fail(-32600, 'jsonrpc must be "2.0"');

    try {
      if (method === 'tasks/list') {
        const limit = Number((params as { limit?: unknown }).limit ?? 100);
        return res.json({ jsonrpc: '2.0', id, result: { tasks: tasks.list(limit).map(toGuiTask) } });
      }

      if (method === 'tasks/cancel') {
        const taskId = A2ATaskStore.validateTaskId(String((params as { id?: unknown }).id ?? ''));
        const canceled = tasks.cancel(taskId);
        if (!canceled) return fail(-32602, `task '${taskId}' is not known to this node`, 404);
        emit('a2a.task.canceled', `task ${taskId} canceled`, true);
        return res.json({ jsonrpc: '2.0', id, result: toGuiTask(canceled) });
      }

      if (method === 'tasks/send') {
        const taskId = A2ATaskStore.validateTaskId(String((params as { id?: unknown }).id ?? `a2a-${Date.now().toString(36)}`));
        const skillId = String((params as { skill?: unknown }).skill ?? '').trim();
        if (!skillId) return fail(-32602, 'params.skill is required');

        const message = (params as { message?: { parts?: Array<Record<string, unknown>> } }).message;
        const dataPart = message?.parts?.find((part) => part?.type === 'data');
        const skillParams = (dataPart?.data ?? {}) as Record<string, unknown>;
        if (typeof skillParams !== 'object' || Array.isArray(skillParams)) return fail(-32602, 'message.parts[].data must be a JSON object');

        // Idempotency: the same task id with the same payload returns the original
        // task instead of executing and charging twice.
        const idempotencyKey = crypto
          .createHash('sha256')
          .update(`${taskId}|${skillId}|${JSON.stringify(skillParams)}`)
          .digest('hex');

        const duplicate = tasks.findIdempotent(taskId, idempotencyKey);
        if (duplicate) {
          return res.json({ jsonrpc: '2.0', id, result: { ...toGuiTask(duplicate), idempotentReplay: true } });
        }
        if (tasks.get(taskId)) return fail(-32005, `task id '${taskId}' already exists with different parameters`, 409);

        const requesterNodeId = String(req.headers['x-a2a-node-id'] || 'anonymous-peer').slice(0, 128);
        const created = tasks.create({
          id: taskId,
          skill: skillId,
          params: skillParams,
          requesterNodeId,
          responderNodeId: identity.get().nodeId,
          idempotencyKey,
        });

        tasks.transition(taskId, 'working', `dispatched to ${skillId}`);
        const outcome = await skills.execute(skillId, skillParams);

        const finished = outcome.success
          ? tasks.transition(taskId, 'completed', 'skill returned a verified result', {
              artifacts: [{ type: 'data', data: outcome.result, checksum: outcome.checksum }],
              executionTimeMs: outcome.executionTimeMs,
              checksum: outcome.checksum,
            })
          : tasks.transition(taskId, 'failed', outcome.error || 'skill execution failed', {
              executionTimeMs: outcome.executionTimeMs,
            });

        emit(
          outcome.success ? 'a2a.task.completed' : 'a2a.task.failed',
          `${skillId} for ${requesterNodeId}: ${outcome.success ? 'completed' : outcome.error}`,
          outcome.success,
        );

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            ...toGuiTask(finished ?? created),
            sandbox: {
              terminatedByLimit: outcome.terminatedByLimit,
              staticFindings: outcome.staticFindings,
              executionTimeMs: outcome.executionTimeMs,
            },
          },
        });
      }

      return fail(-32601, `method '${method}' is not implemented`, 404);
    } catch (error) {
      return fail(-32603, error instanceof Error ? error.message : String(error), 400);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Operator surface
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/api/a2a/tasks', invokeLimit, requirePeerAuth, (req, res) => {
    res.json({ success: true, tasks: tasks.list(Number(req.query.limit || 100)).map(toGuiTask), counts: tasks.counts() });
  });

  router.get('/api/a2a/identity', deps.requireMutationAuth, (_req, res) => {
    res.json({ success: true, identity: identity.get(), capabilityDigest: skills.capabilityDigest() });
  });

  router.post('/api/a2a/publish-skill', deps.requireMutationAuth, (req, res) => {
    try {
      const listing = skills.publishListing(req.body ?? {});
      emit('a2a.listing.published', `listing ${listing.id} published at ${listing.priceUsdc} USDC`, true);
      res.status(201).json({ success: true, skill: listing });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/a2a/retire-skill', deps.requireMutationAuth, (req, res) => {
    const id = String(req.body?.id || '');
    res.json({ success: skills.retireListing(id) });
  });

  router.get('/api/a2a/packages', deps.requireMutationAuth, (_req, res) => {
    res.json({ success: true, packages: skills.listPackages(), listings: skills.listListings() });
  });

  /** Staging peer code never enables it. Promotion is a separate, explicit act. */
  router.post('/api/a2a/packages/stage', deps.requireMutationAuth, (req, res) => {
    try {
      const staged = skills.stagePackage({
        id: String(req.body?.id || ''),
        version: req.body?.version ? String(req.body.version) : undefined,
        code: String(req.body?.code || ''),
        authorNodeId: String(req.body?.authorNodeId || 'operator'),
      });
      emit('a2a.package.staged', `package ${staged.id} staged as UNVERIFIED`, true);
      res.status(201).json({
        success: true,
        package: staged,
        note: 'Package stored disabled. It cannot execute until an operator promotes it.',
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/a2a/packages/:id/promote', deps.requireMutationAuth, (req, res) => {
    try {
      const promoted = skills.promotePackage(req.params.id, String(req.body?.operator || 'Operator'));
      emit('a2a.package.promoted', `package ${promoted.id} promoted to OPERATOR_APPROVED`, true);
      res.json({ success: true, package: promoted });
    } catch (error) {
      res.status(409).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/a2a/packages/:id/quarantine', deps.requireMutationAuth, (req, res) => {
    try {
      res.json({ success: true, package: skills.quarantinePackage(req.params.id, String(req.body?.reason || '')) });
    } catch (error) {
      res.status(404).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handshake diagnostics (outbound, guarded)
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/api/a2a/handshake', outboundLimit, deps.requireMutationAuth, async (req, res) => {
    const targetEndpoint = String(req.body?.targetEndpoint || '').trim();
    const bearerToken = String(req.body?.bearerToken || '');
    const startedAt = Date.now();
    const node = identity.get();
    const steps: Array<{ step: string; status: 'passed' | 'failed' | 'warning'; latencyMs: number; details: string; timestamp: string }> = [];
    const diagnosticLog: string[] = [];

    const addStep = (step: string, status: 'passed' | 'failed' | 'warning', latencyMs: number, details: string) => {
      steps.push({ step, status, latencyMs, details, timestamp: new Date().toISOString() });
      diagnosticLog.push(`[${status.toUpperCase()}] ${step}: ${details}`);
    };

    const guardStarted = Date.now();
    const check = await checkPeerUrl(targetEndpoint, guardOptions());
    if (!check.allowed) {
      addStep('Endpoint policy', 'failed', Date.now() - guardStarted, check.reason || 'endpoint rejected by peer guard');
      return res.json({
        success: true,
        tokenValidated: false,
        roundTripTimeMs: Date.now() - startedAt,
        report: {
          timestamp: new Date().toISOString(),
          nodeId: node.nodeId,
          targetEndpoint,
          tokenConfigured: Boolean(bearerToken),
          tokenPreview: previewToken(bearerToken),
          overallStatus: 'unreachable',
          totalLatencyMs: Date.now() - startedAt,
          steps,
          diagnosticLog,
        },
      });
    }
    addStep('Endpoint policy', 'passed', Date.now() - guardStarted, `resolved to ${(check.resolvedAddresses || []).join(', ')} and passed the SSRF guard`);

    const cardResponse = await guardedPeerFetch(
      `${targetEndpoint.replace(/\/+$/, '')}/.well-known/agent.json`,
      { method: 'GET', headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {} },
      guardOptions(),
    );

    let tokenValidated = false;
    let overallStatus: 'healthy' | 'degraded' | 'unreachable' | 'auth_failed' = 'unreachable';

    if (cardResponse.status === 401 || cardResponse.status === 403) {
      addStep('Agent card', 'failed', cardResponse.latencyMs, `peer rejected the presented token with HTTP ${cardResponse.status}`);
      overallStatus = 'auth_failed';
    } else if (!cardResponse.ok) {
      addStep('Agent card', 'failed', cardResponse.latencyMs, cardResponse.error || `peer answered HTTP ${cardResponse.status}`);
      overallStatus = 'unreachable';
    } else {
      let card: Record<string, unknown> | null = null;
      try {
        card = JSON.parse(cardResponse.bodyText) as Record<string, unknown>;
      } catch {
        card = null;
      }
      if (!card || typeof card.name !== 'string') {
        addStep('Agent card', 'warning', cardResponse.latencyMs, 'peer answered but the body is not a recognisable agent card');
        overallStatus = 'degraded';
      } else {
        tokenValidated = Boolean(bearerToken);
        addStep('Agent card', 'passed', cardResponse.latencyMs, `peer identifies as "${String(card.name).slice(0, 80)}"`);

        // Signature check: only a card that carries both a signature and the key
        // it was signed with can be reported as cryptographically verified.
        if (typeof card.signature === 'string' && typeof card.publicKeyPem === 'string') {
          const { signature, signatureAlgorithm, signedAt, publicKeyPem, ...signedBody } = card as Record<string, unknown>;
          const verified = A2AIdentityStore.verifyDetached(signedBody, String(signature), String(publicKeyPem));
          const idBound = typeof card.nodeId === 'string' && A2AIdentityStore.nodeIdMatchesKey(String(card.nodeId), String(publicKeyPem));
          addStep(
            'Card signature',
            verified && idBound ? 'passed' : 'failed',
            0,
            verified
              ? idBound
                ? 'Ed25519 signature verified and the node id derives from the presented key'
                : 'signature verified but the declared node id does not derive from the key'
              : 'Ed25519 signature did not verify against the presented key',
          );
          overallStatus = verified && idBound ? 'healthy' : 'degraded';
        } else {
          addStep('Card signature', 'warning', 0, 'peer card is unsigned; identity is asserted, not proven');
          overallStatus = 'degraded';
        }
      }
    }

    const totalLatencyMs = Date.now() - startedAt;
    if (totalLatencyMs > 500) diagnosticLog.push(`[WARNING] handshake round trip ${totalLatencyMs} ms exceeds the 500 ms threshold`);
    emit('a2a.handshake', `${targetEndpoint}: ${overallStatus}`, overallStatus === 'healthy');

    res.json({
      success: true,
      tokenValidated,
      roundTripTimeMs: totalLatencyMs,
      report: {
        timestamp: new Date().toISOString(),
        nodeId: node.nodeId,
        targetEndpoint,
        tokenConfigured: Boolean(bearerToken),
        tokenPreview: previewToken(bearerToken),
        overallStatus,
        totalLatencyMs,
        steps,
        diagnosticLog,
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Discovery scanner
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/api/a2a/scraper/status', deps.requireMutationAuth, (_req, res) => {
    res.json(scraper.getState());
  });

  router.post('/api/a2a/scraper/config', deps.requireMutationAuth, (req, res) => {
    try {
      res.json(scraper.configure(req.body ?? {}));
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/a2a/scraper/trigger', outboundLimit, deps.requireMutationAuth, async (_req, res) => {
    try {
      res.json(await scraper.scanOnce('OPERATOR_TRIGGERED'));
    } catch (error) {
      res.status(503).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/a2a/scraper/ping-pathway', outboundLimit, deps.requireMutationAuth, async (req, res) => {
    try {
      const handshake = await scraper.pingPathway(String(req.body?.pathwayId || ''));
      res.json({ success: true, handshake });
    } catch (error) {
      res.status(404).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/** Adapts the durable task record to the field names the dashboard renders. */
function toGuiTask(task: A2ATask) {
  return {
    id: task.id,
    skill: task.skill,
    status: { state: task.status.state, message: task.status.message },
    created_at: Date.parse(task.createdAt),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    requesterNodeId: task.requesterNodeId,
    responderNodeId: task.responderNodeId,
    artifacts: task.artifacts,
    history: task.history,
    executionTimeMs: task.executionTimeMs,
    checksum: task.checksum,
  };
}

function previewToken(token: string): string {
  if (!token) return '';
  return token.length <= 8 ? '********' : `${token.slice(0, 4)}…${token.slice(-2)}`;
}
