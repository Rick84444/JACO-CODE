# JACO Cognitive Live Workspace

## Implemented experience

[REAL] The canonical client is rebuilt around a single conversation. JACO's existing logo, dark colour scheme and project tools remain. Conversation is the start view; code, preview and evidence open from the work. Terminal, Git, models, skills, devices and budget are still connected to existing functions.

The design starts from three questions: what are we trying to do, what has been observed and what can actually be proven? That is why the mission sits close to the input field, real work events are in the same timeline as the conversation, and the result's evidence is in a contextual workspace. The user does not need to follow internal agent names or keep several chats open.

[REAL] `Ask` sends a question about the current work. `Mission` registers a new goal via the existing start chain. A registration is shown only after a confirmed mission ID, for both the full runtime and Lite. A rejected call keeps the text. Ask mode uses a server-restricted set of read tools; the model may not create missions, change policy, switch the planning provider or deliver code that way. A negative test explicitly tries to choose `start_goal` and checks that no mutation happens.

[REAL] The conversation stays mounted across view switches, even when it is hidden on mobile. Drafts are kept, the saved chat is read from the existing encrypted storage and a failed first read can be retried. Questions get the latest observed events and the current mission as context. The server's `current_work` tool can also read the evidence directly from the runtime.

## Events and evidence

[REAL] `GET /api/aura/workbench/live` publishes SSE with the schema `jaco.cognitive-live/v1`. The route's existing `requireLocalUi` and project binding apply. Events are read from the existing SQLite bus and the volatile runtime stream. No separate event database or new listening service is introduced.

| Evidence | Presentation |
| --- | --- |
| Mission registered | Received goal, without a claim of completed work |
| Tool step started | Actual action and referenced file when there is one |
| Result without verification | Verification missing |
| `ok: true` and `verified: true`, without a contradicting error | Verified tool result |
| Error, failed exit code or negative result | The step failed |
| Unknown outcome | Check needed before the step is repeated |
| Changed plan with a reported reason | Decision and the recorded reason |
| Interrupted connection | The connection needs to be restored; history is kept |

[REAL] The narrative is a deterministic summary of the events' bounded fields. It generates no internal stream of thought or invented activity. Heartbeats and empty development cycles are filtered out. Raw tool arguments and full outputs are not part of the live contract; known secrets and token patterns are redacted. A verified step does not mean the whole product is approved.

[REAL] Every persistent observation has a sequence ID, mission ID and timestamp. `Last-Event-ID` makes reconnection possible. Persistent receipts take priority on duplicates; volatile observations are marked as such in the evidence view. Up to 300 stored rows are replayed per connection and the client's feed is limited to 400 observations. Missing older replay is marked explicitly; older storage is not deleted.

## Live creation

[REAL] Monaco is loaded only when the code view is opened and is then kept between view switches so the editor is not restarted during work. The initial client bundle is about 379 kB, compared with about 3.76 MB before the split. The code editor's hash check, save function, Git operations and existing permission boundaries are still used.

[REAL] The open file is observed while code or preview is shown: on a referenced event and otherwise every three seconds. A clean document updates automatically. If the user has their own unsaved draft, the draft and its original hash are preserved; a conflicting save is rejected. Reading the new version and replacing the draft requires an explicit action in the interface.

[REAL] HTML is previewed from the current file content in an iframe with a separate origin, `sandbox="allow-scripts"` and a CSP that blocks external connections, forms and base URL. The verified browser check tries to change the IDE parent's document and fails. Composite projects with separate CSS/JS resources still need their usual development server; this first integrated preview is for self-contained HTML. Verified result links can be opened separately.

## Verification and scope

[REAL] Verified locally with Node 24: full TypeScript check, production build of client and server, and 43 contract and integration tests. The tests cover transport over a real HTTP socket, SQLite reopening, encrypted conversation storage, failed receipts, secrecy filters, old GUI contracts and the boundary for ask tools.

[SIMULATED] 15 browser checks run the real production client against a controlled test server. They use the real storage and SSE handler; the model answer and mission events are test data. The checks cover desktop and mobile viewport, the same draft across views, context for questions, persistent replay, editor, isolated and updated HTML, protection of unsaved changes, reconnection and correct errors on mission registration. The images below show this check and are labelled in the image itself.

![Desktop in controlled UI verification](evidence/cognitive-workspace-desktop.png)

![Work in controlled UI verification](evidence/cognitive-workspace-live.png)

![Evidence in controlled UI verification](evidence/cognitive-workspace-evidence.png)

![Mobile viewport in controlled UI verification](evidence/cognitive-workspace-mobile.png)

Run from the repository root:

```sh
node --test tests/nova/cognitive-live.test.mjs tests/nova/aura-chat-session.test.mjs tests/nova/aura-truthful-gui.test.mjs tests/nova/aura-gui-audit.test.mjs tests/nova/nova-activity-text.test.mjs tests/nova/aura-seer-chat.test.mjs
npm --prefix runtime run lint
npm --prefix runtime run build
JACO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/nova/cognitive-workspace.browser.mjs
```

[REAL] The GitHub workflow `Cognitive Live Workspace` builds client/server and runs the checks on Node 24 with Chromium. The browser tools are installed separately from the product's dependencies.

[UNKNOWN] The operator's Android/Windows runtime, real model inference, Workplace registration and the published IDE could not be run in this environment. Workplace on loopback was unavailable; the development was done in an isolated branch with status `DEGRADED_UNSYNCED`. This is verified code and a controlled UI integration, not a claim about an updated phone or production environment.

[SPEC] The remaining 2027 vision is richer reported sub-goals, reasons for technical decisions, project-specific history and verified experience reused between missions. This change builds the experience and the connection to the existing runtime; it introduces no new planner, self-learning engine or agent architecture.
