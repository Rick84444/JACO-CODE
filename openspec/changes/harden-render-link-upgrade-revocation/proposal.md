# Harden JACO Link host admission after WebSocket upgrade authorization

## Problem

The existing Render adapter validates the host during the HTTP WebSocket upgrade request. Device revocation can occur after that validation but before `room.accept()`. A late socket could otherwise enter the connected-host set after revocation.

## Proposed change

Keep the existing JACO Link room, encrypted store, account-serial queue and WebSocket transport. Re-check the persistent revocation marker inside the account queue immediately before admitting a host. Do not process a socket's messages before admission. Fail closed if PostgreSQL is unavailable.

## Acceptance and falsifier

An upgrade authorized before device revocation, but accepted after revocation, MUST close with 4003 and never join the host socket set. A normal host MUST be admitted after the persistent check. A database read failure MUST close with 1011 without admission.

A host joining the active socket set despite a revoked marker falsifies the safety claim. CI tests are controlled fakes, not proof of deployed Render/ChatGPT connectivity.

## Scope

This is a stacked safety correction for PR #420; no second relay, no OAuth shortcut, no autonomous host execution, no provider credentials, no change to main, and no deployment.
