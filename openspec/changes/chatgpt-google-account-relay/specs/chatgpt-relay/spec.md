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

## Requirement: execute from the ordinary ChatGPT mobile conversation
Given a JACO customer with a valid OAuth MCP connection and a paired Aura host,
when the customer asks ChatGPT on their phone to perform an allowed mission,
ChatGPT MUST be able to invoke JACO's MCP tool, return a true admission ID,
observe mission and verified step receipts, and report the result in that same
conversation. The customer MUST NOT need to visit a separate JACO PWA,
invoke a local shell, or provide another manual gateway token for each task.

The cloud transport MUST send the same scoped requests irrespective of mobile
or desktop ChatGPT client. A pending or accepted mission MUST NOT be reported
as completed without verified execution evidence.

## Requirement: distinguish remote Aura from Android device control
Running ChatGPT on the phone SHALL require no Android inference runtime and no
Termux installation. Any control of Android apps, screen or files on the phone
MUST require separate OS-supported device authorization, explicit pairing
and bounded tool permissions; a browser/PWA control surface alone is not
proof of OS automation.

## Requirement: cold-start from a paired ChatGPT account
An authenticated ChatGPT conversation MAY request that an installed JACO host
start Aura only when its existing device identity is paired, revocation is
checked, the host's lifecycle owner is independently online, and activation
is explicitly allowed. The receiver SHALL use the existing Sentinel
supervisor and produce a real Core/Workplace readiness receipt. A host offline
with no independent receiver MUST report OFFLINE, not fake activation.

## Requirement: monitoring and reverse-call invitations
A scoped ChatGPT client SHALL be able to inspect durable mission state and
verified receipts across turns. Aura MAY create a bounded durable
CALL_REQUESTED invitation to a connected ChatGPT interface, with consent
and device scope. The invitation SHALL remain pending until a real supported
client or separately authorized service acknowledges and responds. It MUST
NOT be interpreted as a cloud LLM waking up autonomously or completing work.
