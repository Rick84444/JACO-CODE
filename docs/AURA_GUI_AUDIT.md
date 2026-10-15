# Aura GUI audit — 2026-10-05

## Scope and ownership

The active product entry point is the nested app's `src/App.tsx`, importing `JacoAuraComputeIDE.tsx`. Reviewed its explorer/editor, Source Control, Tools/MCP, Skills, Devices, Providers/Nova planner, Revenue, chat, Agent Board, command palette, approval panel, runtime visualization and bottom panels. Input hints such as model names and repository URLs are real form guidance, not simulated features; they were retained.

The installed GUI on port 3000 was inspected without changing missions, accounts, device permissions or spending. Workplace registration was attempted but port 2995 returned ECONNREFUSED. Coordination state is DEGRADED_UNSYNCED; this report is the local handoff pending Workplace availability.

## Bugs and misleading placeholders corrected

| Area | Finding | Correction |
| --- | --- | --- |
| Chat/navigation | Mobile tab changes, desktop chat overlay and breakpoint changes remounted chat and lost its state. | One UI session controller in the IDE owns messages, input, tool arguments and in-flight busy state. Mobile chat remains mounted while hidden. |
| Editor save | A save response unconditionally removed the draft, including edits made after submission. | Remove a draft only when it exactly matches the saved version. |
| Editor tabs | Closing the last file allowed the next file-list refresh to open the first file again. | Automatic initial selection happens once; later refreshes respect a closed editor. |
| Layout | A full-viewport IDE inside a padded outer main created page overflow and clipping. | Remove the outer bottom padding and constrain the app to the viewport. |
| API errors | Structured errors became `[object Object]`; malformed HTTP-200 bodies could be treated as success. | Shared response parsing rejects malformed bodies and formats structured errors. |
| Status copy | Welcome text claimed SEER connectivity without a request; headings claimed all events verified and Level-5 authority. | Use neutral instructions and per-event status; visualization describes observations. |
| Device setup | A personal IDE domain was the default and a missing hub address generated placeholder join commands. | Public IDE host is explicit configuration; absent host denies proxied access. Missing addresses disable pairing and display configuration requirements. Keyboard submission checks the same requirement. |
| Device operations | Mutation failures were cleared by a subsequent list refresh; repeated clicks remained available during requests. | Separate action errors from polling errors, disable in-flight mutations and surface clipboard failure. Network errors describe unconfirmed outcomes. |
| Skills | Proposal/device failures were silently swallowed; failed decisions were immediately cleared; delayed selection could show the wrong skill. | Surface source errors, keep failed decision feedback and correlate detail responses to the latest selection. Prevent edits/selection during mission creation. |
| Revenue | Missing values became zero; a recent empty list claimed no payment ever occurred; network failure invented configured=true. | Distinguish unavailable values from observed empty values, describe only the fetched list and keep configuration unknown on network failure. |
| Planner | Error responses could populate invalid state and crash rendering; controls could act without loaded configuration. | Validate the response and choices, report structured errors and disable actions before state is available. Describe automatic routing according to server policy. |
| Provider status | Credential-reference presence was presented as a definitive authentication requirement. | Show whether an API key/reference is configured, without implying every local endpoint requires login. |
| Workbench polling | Visibility changes could create overlapping polling chains; stalled reads had no timeout. | Guard in-flight polling and bound workbench/file-list reads. Retained observations show a stale status after failure. |

## Verification evidence

- 85 tests passed across GUI audit, integrations, account projection, agent board, provider selection/registry, Ollama cost guards, SEER chat, truthful GUI, IDE access, devices, Stripe revenue and planner choice suites.
- Source and merged installed runtime TypeScript checks passed.
- Frontend Vite and backend CommonJS esbuild builds passed. Existing large-bundle and guarded import.meta warnings remain.
- Packaged server started with fresh disposable state on loopback port 3087. No production mission database or inference/payment credentials were copied.
- Desktop chat draft survived opening and closing its overlay.
- An unsaved disposable file survived switching to Agent Board and back. Its GUI save was checked directly in the disposable file on disk.
- At 390x844, chat draft survived desktop-to-mobile layout change and mobile navigation to Files and back.
- Device view showed missing public-host configuration with pairing disabled. Revenue showed unconfigured Stripe without invented figures.
- Agent Board reported unavailable Workplace explicitly. Stopping only the owned test server retained the last board observation and showed an error/stale timestamp. Restarting the test server and refreshing cleared the transport error; Workplace remained correctly unavailable.
- No LLM request, paid operation, push, merge, account login, device invitation/revocation or approval decision was executed during this audit.

## Delivery and remaining limits

GUI changes were merged into the installed source with original-file backups and preservation of unrelated changes. The running port-3000 process was not restarted. The earlier automatic review rejection of production restart remains a boundary; source/build verification does not prove that the installed process loaded this audit's changes.

This is a review and correction of the active Aura GUI. It is not an ISO, Android hardware, public exposure or full product release certification. Real Git operations, remote device pairing, paid planner tests and mission approval execution still require their own authorized integration verification. Legacy backend release-audit/native-attestation fallbacks were outside the active GUI paths reviewed here and must not be used as launch evidence.

## Reflection

Recurring failure patterns were treating request transport as a completed outcome, losing UI state on remount, and converting missing observations to reassuring defaults. Shared API parsing, correlated save acknowledgement and a single chat session controller address these patterns without adding a new runtime authority or execution engine.
