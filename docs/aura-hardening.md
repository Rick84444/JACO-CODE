# Aura recovery and review integration

The canonical implementation lives in `runtime/`. Do not install a second copy of
`src/components` or replace the current editor with an unreviewed bundle.

## Recovery behavior

- Unsent text and changed code drafts survive reloads in the same browser tab.
  Recovery is scoped by the project root returned by the server. It does not
  automatically submit messages, start missions or save files.
- A recovered code draft retains the original content and hash. Saving still
  sends that original `expectedHash`; newer disk content causes a conflict.
- Drafts use tab-local `sessionStorage`, not the encrypted mission/chat database.
  They are not a durable backup and may disappear when the tab is closed. Storage
  failures are visible. Closing or logging out with unsaved work is guarded.
- A history write has a ten-second deadline. Waiting for a model can be cancelled
  separately from a mission. Cancelling the browser wait does not prove the server
  stopped; the UI says so. It never automatically retries a model or a mutation.
- Retrying an unconfirmed history write in the mounted conversation reuses its
  message ID. The server's existing chat store reconciles this ID.
- A failed provider refresh marks the observation stale. Listing models is not
  proof that a selected model can answer; `Använd` performs the existing inference
  test before changing the shared model choice.

Run the recovery unit tests with:

```sh
node --test tests/nova/aura-recovery.test.mjs runtime/src/lib/auraProject.test.mjs
```

The production-client browser cases are in
`tests/nova/cognitive-workspace.browser.mjs`. They use controlled server responses
and the real durable mission/chat stores; they do not run a model or an agent.

## Shadow Council bundle boundary

The supplied `jaco-aura-autonomous-stack-v1` description is an integration proposal;
its implementation files were not supplied. No Shadow Council service, digest
stream or reputation persistence is claimed by this change.

Integrate future review behavior into the existing Continuum scheduler,
evidence ledger and event store. A reviewer result must identify the artifact
hash, code revision, acceptance condition and actual test run. A deterministic
finding alone must not certify a Knowledge Object or raise execution authority.
Reputation is a record of observed review outcomes, not permission to bypass the
server's execution contracts, tool gateway, sandbox or operator approval.

A future `useShadowCouncil`/badge can project an authenticated server digest. It
must expose stale/disconnected states and lack of evidence, and must not announce
that background review is active merely because an SSE connection opened.
Client path helpers and editor flush callbacks are usability mechanisms; the
existing server workspace-path and expected-hash checks remain authoritative.
