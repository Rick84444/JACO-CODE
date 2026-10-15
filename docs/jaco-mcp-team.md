# JACO MCP team

JACO owns the workspace, Workplace coordination, SEER planning, Nova execution and receipts. MCP clients such as Codex and Claude use the same workbench. A registered name is self-reported; it does not prove a model or application identity, or autonomous execution.

## Local installation

Start JACO with the canonical `agents/start-all.ps1` launcher. Configure each MCP client with `node` and the absolute path to `runtime/tools/jaco-editor-mcp.mjs`. Set `JACO_RUNTIME_URL` to this machine's local runtime and `JACO_WORKPLACE_URL` to the local Workplace (normally ports 3000 and 2995). `.mcp.json` includes the repository-relative entry. Codex uses its own config.toml; restart the client after changing its configuration.

The server registers from initialize.clientInfo.name, syncs and ACKs Workplace, then keeps heartbeat and live sync using agents/lib/workplace-session.mjs. Metadata is self-reported. Set JACO_AGENT_STABLE_ID explicitly when installations need distinct stable identities. No model key is needed for file/Git/read-only tool operations. The MCP process does not spawn Claude, Codex or paid model calls.

## Team workflow

1. Read `team_status`, `team_inbox` and `mission_status`. Retain the main objective and mission id.
2. Acquire `team_claim` for a shared resource before editing. Use an absolute project-qualified resource name so two repositories cannot collide accidentally. An existing lease denies a competing writer.
3. Read and edit with the existing hash-based editor tools. Requests carry the initialized project root; a GUI project switch rejects stale requests with WORKBENCH_PROJECT_CONFLICT. Explicit open_project adopts a new project.
4. Use `mcp_servers` to discover tools. `local_tool_call` accepts only exact tools advertised as read-only. Commands, browser mutations and broader work go through existing Nova contracts via start_goal. start_goal may invoke the configured model and budget; it is not an arbitrary shell.
5. Inspect `mission_status` for observed mission status and receipts. Starting or selecting an agent is not proof of completion.
6. Post authorized MESSAGE, FINDING or HANDOFF events with `team_post`; use a stable eventId on retries. Release claims with team_release. Closing the client ends the session and releases its claims.

The inbox returns an explicit nextCursor. Pass it as after on the next read. Background transport ACK is not acknowledgement that the model read an assignment. The buffer holds 200 events and reports overflow/droppedThrough; after overflow, resynchronize the durable Workplace context before acting. Live polling defaults to two seconds; this is not zero-latency or offline multiwriter replication. Unsynchronized mutations are denied.

## Multiple JACO devices

Use the existing Enheter page and tools/join-hub.mjs; do not create a second device registry. Verify the issuing hub URL first. Pairing exchanges a single-use, expiring code for a per-device revocable key. HTTPS is required outside loopback. Do not paste keys into chats, commits or MCP configuration shared with other users.

Each phone/computer runs its own local JACO/Nova. For a joined device, configure JACO_HUB_URL and JACO_DEVICE_KEY through the existing pairing flow. The canonical Workplace client uses the authenticated device gateway. Hub memory access requires the operator's explicit grant; revocation is checked on each request. Device sessions cannot create shared claims, decisions or missions with their restricted keys. The hub routes execution to nova@device through existing durable mission contracts. Remote devices must not directly mutate the hub's Git index; local workers own their checkout and return receipts for review/integration.

Claude and Codex each need an online client capable of consuming assignments and responding. MCP transport and presence alone do not provide an external application's autonomous scheduler. SEER mission graphs own dispatch and verification; /cortex/dispatch candidate selection alone is not execution.

## Verification and boundaries

Run `node --test tests/nova/jaco-editor-team.test.mjs tests/nova/jaco-team-live.test.mjs tests/nova/workbench-project-binding.test.mjs tests/nova/device-access.test.mjs tests/nova/private-workplace.test.mjs`.

The live integration test runs a real Workplace server and two real stdio MCP processes with explicit test identities. Its workbench is a test fixture. It checks targeted delivery, exclusive claims, disconnect cleanup, read-only policy and hub-loss denial. Device tests cover per-device mission isolation, private shared memory and revocation. These are not evidence that the physical phone, local computer and laptop as a connected team, or that Claude or Codex executed an autonomous mission. Physical-device and actual external-client acceptance require their available authenticated endpoints and matching receipts.

No public listener, tunnel, new device permission or paid autonomous job is enabled by this change. Local runtime project binding is backward-compatible with GUI requests lacking the MCP header; it prevents accidental project changes, not malicious clients that omit the header. Hash writes remain the final concurrent file protection.
