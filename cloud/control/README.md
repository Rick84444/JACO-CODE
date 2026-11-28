# JACO Cloud Render validation

The service adapts the canonical JACO Link and remote PWA to HTTPS/WSS plus encrypted PostgreSQL storage. No second Aura runs on Render. The private operator Cloudflare channel is unchanged. The separate cloud handoff contract and mission store are included but not yet bound to a production OAuth MCP dispatcher.

The validation Blueprint uses free plans, disables Link and automatic deployment, and restricts PostgreSQL to internal traffic. It binds DATABASE_URL through Render; secrets are never committed. The free DB is temporary, not a production ledger.

Acceptance: CI contract, real PostgreSQL concurrency/restart tests, deployed /health (database READY, Link DISABLED), then configure Google OAuth with exact public HTTPS callback /auth/google/callback, independently review tenant/session security, and enable Link in an isolated test. Render requires signed Google ID tokens. Do not import private operator secrets. A production rollout also needs customer OAuth/MCP, canonical evidence verification, migration fencing and real Windows/Android acceptance.

Local migration is explicit: JACO_LINK_ORIGIN can be https://cloud.jacocode.com or the exact validation service https://jaco-cloud-validation.onrender.com. Each uses a separate local pairing file. Existing credentials remain bound to their origin. Restart and re-pair only after verifying the selected cloud endpoint; never run two customer relay owners for one device. The default remains https://jacocode.com.

An enabled service holds an exclusive DB advisory lock. Stop the previous owner before switching enabled deployments until a fenced handover protocol is implemented; automatic zero-downtime replacement cannot safely take the active lease. Disabled validation deployments do not hold it.

No user account sign-in or live host pairing is claimed by this source.
