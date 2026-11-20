# ChatGPT Relay product requirements

## Requirement: account-bound consent, not a hardcoded developer bridge
Given any two Google-verified JACO accounts A and B with independent paired
Aura devices, when each explicitly authorizes the JACO ChatGPT MCP plugin,
the server MUST associate each OAuth access grant with the correct immutable
Google `sub` and exact device identity. It MUST NOT derive identity from
email, GitHub account, default repository, chat text or a user-supplied
`tenantId` field.

## Requirement: authentic connection
A `CONNECTED` badge MUST require a valid nonrevoked OAuth grant, an
authenticated MCP request and a fresh online host receipt. A configured
flag, Git-ref ACK or JACO Link HTTP 200 is insufficient.

## Requirement: no customer tokens or tunnels
The customer MUST NOT need to paste gateway tokens or configure GitHub,
Cloudflare or inbound ports. OAuth credentials MUST be issued and managed
by JACO's server and the approved ChatGPT client. Account pairing and
reauthorization MUST be reversible through user UI.

## Requirement: scoped and nonreplaying control
Read-only access MUST be the safe default. Submitting goals or steering a
mission MUST require separately consented scopes and enforce existing
Aura/SEER/Mission Bus/Nova policies. Network ambiguity after a write MUST
surface `OUTCOME_UNKNOWN` and MUST NOT auto-retry.

## Requirement: isolation
A, B and revoked/orphan device connections MUST NOT access each other's
status, memory, receipts, missions, credentials or command execution.
Tests MUST include crossed-subject tokens, device IDs, replayed OAuth codes,
misbound resource audiences, revoked grants and websocket reconnection.
