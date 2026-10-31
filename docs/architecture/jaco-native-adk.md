# JACO Native ADK v1 — real Aura development contracts

**Status:** implementation with CI and contract tests, not yet host-validated on Pixel/Termux.

## Architecture: one operator, no shadow agent

JACO SDK answers how to call Core APIs. JACO Native ADK answers how to define,
launch and observe a reusable developer program **through the canonical Aura
execution contracts**, without creating another agent loop or permission system.

    Developer-authored, frozen program manifest
                    |
             JACO Native ADK
                    |
          Core 127.0.0.1:3000
             /          \
        /start-goal    /skills/:id/run
             |              |
      SEER strategic    installed JACO Skill Runtime
      goal authority         |
             \            /
               Durable Nova
                    |
         existing policy + tools + leases
                    |
         mission receipts + review
                    |
        ADK read-only mission projection

Aura is the only user-facing agent. SEER is internal strategic planning, Durable
Nova owns mission execution and leases, Workplace supports continuity, and MCP
Tool Fabric owns existing tool calls. A versioned program is a **definition**,
not an independently running agent.

## Implemented developer API

| Method | Actual behavior |
| --- | --- |
| defineAuraProgram(spec) | Validate and freeze an exact versioned manifest, goal or installed skill, and declared read tools |
| adk.inspect() | Fetch actual Aura board, enforce correct one-agent schema and observation age |
| adk.dispatch(program, options) | One explicitly authorized POST to existing SEER or Skill Runtime; never retry a mutation |
| adk.mission(id) | Inspect a real Nova mission and distinguish DONE from independent acceptance |
| adk.awaitMission(id) | Finite, abortable local polling only; never starts an extra supervisor |
| adk.reviewMission(id) | Read the current server review projection without approving it |
| adk.cancelMission(id, options) | Explicit cancellation request through Aura's current API |
| adk.readTool(program, options) | Declared MCP read tool with current read-only metadata and Core authorization |
| onEvent | Optional bounded observability; event fields exclude goals, prompts, tokens and raw tool data |

Source modules: runtime/src/adk/index.mjs, aura-adk.mjs and adjacent ESM
declaration files. Existing SDK remains at runtime/src/sdk/jaco-client.mjs.

## A real program (Node 22+)

    import { defineAuraProgram, createAuraAdk } from './runtime/src/adk/index.mjs';

    const audit = defineAuraProgram({
      id: 'architecture-audit',
      version: '1.0.0',
      description: 'Audit this repository using current source evidence',
      execution: { type: 'goal' }
    });

    const adk = createAuraAdk({ endpoint: 'http://127.0.0.1:3000' });
    const state = await adk.inspect();

    // Call only after a deliberate operator instruction.
    const created = await adk.dispatch(audit, {
      goal: 'Inspect the repository and verify the current integration',
      operatorAuthorized: true
    });
    // created.kind is typically seer-goal. This is NOT a Nova receipt.

A skill program instead uses execution: {type:'skill',skillId:'existing-skill-id'}
and dispatch with input, optional testCommands and operatorAuthorized:true.
The skill must already exist in the trusted runtime registry. Canonical
skills can require tests; the existing runtime enforces these contracts.

## CLI

From repository root:

    node runtime/bin/jaco-sdk.mjs adk:inspect
    node runtime/bin/jaco-sdk.mjs adk:mission mission-<id>
    node runtime/examples/adk-repository-audit.mjs --help
    node runtime/examples/adk-repository-audit.mjs --inspect
    node runtime/examples/adk-repository-audit.mjs --submit "Audit this repo"

The example is read-only by default. A deliberate --submit performs ONE
goal request; it does not run or verify a mission synchronously.
CLI tokens are not logged. Prefer secret-managed launch configuration
for JACO_TOKEN; never paste credentials into source or chat.

## Safety and reliability boundaries

1. **Local only:** workbench mutation endpoints use requireLocalUi, which
   rejects non-loopback/proxied access. The ADK refuses non-loopback URLs
   and does not claim that a bearer token makes these endpoints remote.
2. **No new privilege:** declarations do not install code, grant capabilities,
   start a model, create agents or alter Core policies. Existing approval and
   mission guards remain the only authority.
3. **Explicit human instruction:** operatorAuthorized:true prevents accidental
   SDK mutation. It is an API usage guard, not identity proof or an independent
   authorization system. The server still performs real authorization.
4. **No silent replay:** successful POST without canonical ID or transport
   timeout is outcomeUnknown. The SDK does not retry these mutations.
   Reconcile with server state before resubmitting.
5. **No fake success:** an observed DONE or a tool receipt never becomes
   verified external acceptance by itself. ADK returns accepted:false and
   separates verifiedSteps, uncertainOutcomes and machineVerified.
6. **Bounded reads:** read tool must appear in the frozen manifest, be currently
   advertised as read-only, and pass existing server-side permission checks.
   Tool arguments are JSON-only, bounded and prototype-key checked.
   MCP metadata is advisory, not a security guarantee.
7. **No secret telemetry:** callbacks publish fixed operational identifiers
   and status. The review response may contain sensitive project data:
   callers must keep it private.
8. **No daemon:** abort/timeout stops only this client's wait; a durable mission
   continues under the existing runtime until separately cancelled.
9. **No data migration:** this kit does not read or modify .env, Vault,
   Workplace memory, historical missions or receipts.

## Existing architecture reused, not duplicated

- Canonical Skill Runtime already has versioned skill manifests, procedures,
  test gates and evidence-driven optimization. ADK supplies a developer
  interface to existing skill execution; it does not replace SkillRuntime.
- SEER owns strategic goals; these can fan out into one or more Nova missions.
  An ADK seer-goal result MUST NOT be passed to awaitMission as a mission ID.
- Durable Nova owns checkpoints, leases and uncertain-outcome quarantine.
  The ADK never creates independent leases or claims its own durable state.
- Aura Workbench and the read-only control plane are the live observation
  source, not arbitrary LLM text or legacy agent count cards.

## Explicit limitations / next engineering stages

Not implemented or claimed here: device-tested Termux mission delivery,
an npm-published @jaco/adk release, remote multi-tenant auth, signed third-party
extension packages, sandboxed executable plugin code, durable ADK event
storage, automatic cognitive evolution, cross-repo knowledge promotion, or a
new SEER goal-status API. Calling the first version an enterprise platform
without these gates would misrepresent current evidence.

The sensible next tranche is a signed extension publishing pipeline, trusted
capability manifest resolution, skill-package compatibility checks, provenance
tracking and actual end-to-end verified device runs. Do not replace the
existing Skill Machine or merge Core/Workplace/SEER/Nova into one process
without separate migration and rollback evidence.

## Acceptance

    node --test tests/nova/jaco-native-adk.test.mjs \
      runtime/gateway/test/jaco-client.test.mjs
    node runtime/bin/jaco-sdk.mjs --help
    node runtime/examples/adk-repository-audit.mjs --help

Required before claiming on-device operational status:
- Node 22/24 CI tests and canonical runtime TypeScript/build passes.
- adk.inspect reports actual service failure and recovery, not fake READY.
- Real authorized SEER goal has matching goal ID and descendant Nova mission.
- At least one skill mission completes, native tests pass and receipt evidence
  is independently reviewed. Failed or disconnected tools must fail closed.
- No extra runit ownership, no duplicate planning loop and no data loss.
