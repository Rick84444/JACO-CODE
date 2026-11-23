# Restore JACO Aura execution-client receipts from ChatGPT Workplace Git-ref

## Problem
Tokenless Git-ref ingress is READY on Pixel and GitHub confirms its incoming message, but the local Nova compatibility executor joins Workplace without an onEvents callback. A received QUESTION is ACKed as a stream entry with no agent response.

## Scope
Reuse canonical Workplace, Nova and Git-ref receipts. Add a bounded communication-only ANSWER acknowledgment from the running Nova executor after it has actually received a Git-ref QUESTION. Do not start models, missions or financial services. Do not change permissions or public content exposure.

## Acceptance
- Actual Git-ref QUESTION can yield idempotent ANSWER targeted to the registered ChatGPT transport agent
- Acknowledgment explicitly disclaims reasoning and execution
- Untrusted content cannot issue commands or be echoed beyond a narrow verification marker
- Failed Workplace post remains pending; duplicate event IDs do not duplicate answers
- Existing CI including Nova and Workplace tests must pass

## Falsifier
If Nova is absent or not consuming Workplace, the public receipt has no ANSWER and the transport alone must not claim success. If Git push fails, relay becomes DEGRADED_UNSYNCED.
