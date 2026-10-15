# JACO 0.17.1 — A2A and Hands-Off Hardening

Scope: harden 0.17.0 for launch. Same product, same functions, same GUI. No
component was redesigned and no React file was touched. What changed is the
server-side ground those components stand on.

Evidence for every claim below: `npm run test:a2a-hardening` →
`verification/a2a-hardening.json` (47 checks, all observed at runtime).

---

## 1. What the review found

### 1.1 The A2A surface the GUI calls did not exist

`A2ADiagnostics.tsx` and `A2AWorkflowDashboard.tsx` ship in the release and call:

```
GET  /.well-known/agent.json
POST /a2a                          (JSON-RPC: tasks/send, tasks/list, tasks/cancel)
GET  /api/a2a/tasks
POST /api/a2a/handshake
POST /api/a2a/publish-skill
GET  /api/a2a/scraper/status
POST /api/a2a/scraper/trigger
POST /api/a2a/scraper/config
POST /api/a2a/scraper/ping-pathway
```

`server.ts` served none of them. Every one fell through to
`app.use('/api', … 404 'API route unavailable in Truth-Hardened runtime')`, and
`/.well-known/agent.json` fell through to the SPA catch-all and returned HTML.
The dashboard rendered, polled, and silently showed nothing. `latest-agentcard.json`
still carried `"nodeId": null`, `"verifiedPeerStatus": false`,
`"evidenceState": "UNCONFIGURED"`, and `a2a-openclaw-accounts.json` was `[]`.

The working parts were in `archive/a2a-prototype-016/server/`, and they were
archived for good reason — see 1.2.

### 1.2 The archived skill executor was remote code execution

`archive/a2a-prototype-016/server/skillStore.ts`:

```ts
const wrappedFn = new Function('params', 'require', `${code} …`);
const safeRequire = (mod) => { if (['crypto','path','util','url'].includes(mod)) return require(mod); … };
```

`new Function` compiles into the host realm. The `safeRequire` allowlist is
decoration: the guest already reaches `process`, `globalThis`, `fetch` and the
real module loader directly, so any peer able to publish a skill could read
`process.env` — `STRIPE_SECRET_KEY`, `GEMINI_API_KEY`, `GATEWAY_TOKEN`,
`CLOUDFLARE_API_TOKEN`, `HUGGINGFACE_TOKEN` — and exfiltrate it over the network
this same process has. Peer code was installed to disk and executed on the next
call with no operator step in between.

### 1.3 Node identity could not be verified

`nodeRegistry.ts` minted `jaco-node-${Math.random().toString(36)…}`. There was no
key pair and no signature, so `verifiedPeerStatus` could never legitimately be
true and any peer could claim any node id.

### 1.4 Outbound peer URLs were an SSRF primitive

`pingAndSyncPeer(endpointUrl)` fetched whatever it was handed. On a hosted
deployment that is a request from inside the perimeter to
`http://169.254.169.254/…` — the instance metadata credentials — or a sweep of
the provider's internal network.

### 1.5 Introspection was public once HOST left loopback

`requireMutationAuth` guards mutations. Reads were unguarded, and `render.yaml`
sets `HOST=0.0.0.0`. That published, to anyone who knew the path:

| Endpoint | Exposed |
|---|---|
| `/api/workspace/files` | the entire workspace file tree, up to 5000 paths |
| `/api/activity` | the mission event log |
| `/api/jobs`, `/api/workers/status` | queue contents and worker state |
| `/api/seer/status` | SEER config, strategist URLs, control records, contracts |
| `/api/debugger/incidents` | incident history |
| `/api/seer/conversation` | **unauthenticated inference on the operator's own model credentials** |

There was also no rate limit, no security headers and no request correlation id.

### 1.6 `healthCheckPath: /healthz` was never served

`render.yaml` health-checks `/healthz`. `server.ts` served `/api/health`. `/healthz`
matched the SPA catch-all, so the platform got `200` plus `index.html` whenever
`dist/index.html` existed — a health check that passes while the runtime is wedged,
and returns `503` when the bundle is missing but the process is fine. Both signals
inverted.

### 1.7 The approval gate enforced paths against the wrong root

`approvalGate.ts` called `resolveWorkspaceFile(process.cwd(), …)` three times and
built its `IntuitionContractStore` on `process.cwd()`. The runtime resolves
`WORKSPACE_ROOT = JACO_WORKSPACE_ROOT || JACO_RELEASE_ROOT || cwd`. Whenever either
variable was set — the documented Termux and packaged-install layouts both set one —
the gate validated proposals against a different tree than the workers wrote to.

### 1.8 A claimed job could stall forever

`claimNext()` moves a job to `claimed` and stamps `claimedAt`. Nothing ever
un-claims it, and `claimNext` only considers `queued`. A worker that dies — process
kill, Termux OOM, a free-tier host sleeping — leaves its job `claimed` permanently:
never retried, never failed, invisible as a failure. For a hands-off system that is
the worst failure mode, because the dashboard still shows a healthy queue.

### 1.9 The archived sales orchestrator fabricated evidence and auto-spent

`autonomousSalesOrchestrator.ts` starts a 30-second `setInterval` **in its module
constructor** — importing the file was enough to begin autonomous outbound activity
— and creates Stripe checkouts against hardcoded peers, falling back to a hardcoded
payment link. Its campaign objects ship with `totalOffersSent: 34` as literals under
a `[REAL]` header. `OfflineLedgerPaymentAdapter.verifyWebhook` accepts **any** POST
body as `payment.succeeded` with no signature check at all.

This module is **not** re-enabled by this work. It contradicts the runtime's own
policy that external financial actions have a zero-SEK autonomous limit, and its
webhook path would mark forged payments as settled. Re-enabling it needs a
settlement design, not a wiring change.

---

## 2. What was changed

### New modules

| File | Purpose |
|---|---|
| `src/server/a2a/identity.ts` | Ed25519 node identity, persisted `0600`. Node id derives from the public key, so an id cannot be claimed without the key. Detached signing and verification over canonical JSON. |
| `src/server/a2a/skillSandbox.ts` | Worker thread + fresh `vm` context: no `require`, no `process`, no `fetch`, no timers, code generation disabled. Parameters cross as a JSON string parsed inside the context. Wall-clock, heap and output caps enforced by the parent. |
| `src/server/a2a/peerGuard.ts` | SSRF guard for every outbound peer URL. Blocks private, loopback, link-local/metadata, CGNAT, multicast and IPv4-mapped equivalents; optional hostname allowlist; timeouts, size caps, `redirect: 'manual'`. |
| `src/server/a2a/skillRegistry.ts` | Separates *listing* (an offer, never executable) from *package* (code). Peer code lands `UNVERIFIED`; only an operator promotion makes it runnable; checksum drift at execution time quarantines it. |
| `src/server/a2a/taskStore.ts` | Durable task ledger with idempotency keys, final terminal states, bounded retention, atomic writes. |
| `src/server/a2a/scraperService.ts` | Discovery scanner. Disabled by default, no timer at import, records only what actually answered. |
| `src/server/a2a/router.ts` | Serves the nine endpoints in 1.1 with peer-bearer auth, replay window, nonce cache and per-scope rate limits. |
| `src/server/security/httpHardening.ts` | Security headers, fixed-window limiter keyed on the socket address, request ids, read guard, body-type guard. No new dependency. |
| `src/server/queue/jobReaper.ts` | Lease-based reclamation of jobs abandoned by dead workers, honouring the existing retry budget. |
| `scripts/verify_a2a_hardening.ts` | 47-check runtime suite writing `verification/a2a-hardening.json`. |

### Edited files

| File | Change |
|---|---|
| `server.ts` | +64 lines, all additive: edge middleware, `/healthz` + `/readyz`, read guard, A2A router mounted before the `/api` 404 wall, reaper lifecycle on the existing SIGTERM/SIGINT handlers. No existing route or response body altered. |
| `src/server/gate/approvalGate.ts` | Boundary checks and the contract store rebound from `process.cwd()` to the resolved workspace root. |
| `render.yaml` | `/healthz` now real; `JACO_RUNTIME_VERSION` corrected from the stale `0.12.2`; `A2A_BEARER_TOKEN` generated; `JACO_PUBLIC_READS=false`; peer allowlist slot. |
| `.env.example` | New knobs documented. |
| `package.json` | `test:a2a-hardening` added and wired into `test:build17`; version `0.17.1-a2a-hardened`. |

**Unchanged:** every file under `src/components/`, `src/App.tsx`, `src/main.tsx`,
`vite.config.ts`, and the whole `dist/` bundle. The GUI is untouched.

---

## 3. The trust model, stated plainly

```
listing published        → an offer. Never executes. Signed by this node.
package staged           → code on disk, UNVERIFIED. Refuses to execute.
operator promotes        → OPERATOR_APPROVED. Executes in the worker sandbox.
checksum drift at run    → QUARANTINED. Refuses to execute.
```

A peer can list a skill and be paid for it without ever being able to run code on
this node. That is the property that makes an open A2A marketplace safe to launch.

---

## 4. Launch checklist

```bash
npm run lint                  # tsc --noEmit
npm run test:a2a-hardening    # 47 checks -> verification/a2a-hardening.json
npm run test:build17          # full gate, now including the A2A suite
npm run build
```

Before exposing the runtime beyond loopback:

- [ ] `GATEWAY_TOKEN` set (mutations **and**, now, introspection reads)
- [ ] `A2A_BEARER_TOKEN` set — without it the JSON-RPC endpoint refuses every
      non-loopback call rather than serving anonymously
- [ ] `JACO_PUBLIC_READS` left `false` unless the introspection surface in 1.5 is
      meant to be world-readable
- [ ] `JACO_A2A_PEER_HOSTS` set if peers are known in advance
- [ ] Health check pointed at `/healthz`, readiness at `/readyz`
- [ ] `.jaco/node_identity.json` backed up — it is this node's identity; losing it
      means every peer that pinned the id must re-verify
- [ ] No skill package promoted that you have not read

---

## 5. Limitations — stated, not hidden

1. **`vm` is defence in depth, not a kernel boundary.** A V8 escape leaves the
   context. That is why peer code stays non-executable until promoted, and why
   genuinely untrusted code still belongs behind OS-level isolation.
2. **DNS rebinding.** The guard resolves before the request and Node resolves again
   at connect. A hostile resolver can differ between the two. `JACO_A2A_PEER_HOSTS`
   is enforced on the hostname and is not subject to that race.
3. **Rate limiting is per process, in memory.** Correct for one instance. Multiple
   replicas need a shared counter.
4. **The read guard is all-or-nothing.** There is no per-endpoint scope yet; a
   public GUI plus private introspection needs an auth proxy in front.
5. **No queue retention pruning.** `.jaco/job_queue.json` still grows without bound.
   The reaper fixes stalling, not growth.
6. **The sales orchestrator remains archived** — see 1.9. Settlement needs a design
   pass, starting with a webhook path that actually verifies a signature.
