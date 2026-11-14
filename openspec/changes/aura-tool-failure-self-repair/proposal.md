# Aura diagnoses and repairs failed tools itself

## Why
After a tool failure the agent loop only told the model to choose a different tool. Aura could not see why a server stopped, whether a command was missing or whether a local service was down, and nothing started a stopped server or the local stack on its behalf. The operator should not have to act as the debugger.

## What Changes
- A bounded diagnosis step classifies the failure, gathers evidence (server status, startup log tail) and applies the one safe, idempotent remedy that exists: start a configured MCP server, or request recovery of the local stack through the existing launcher (cooldown, lock-protected).
- The findings, with a concrete next step per failure class, reach the model before its next decision.
- Credentials, permission, approval, budget and unknown-outcome failures are never worked around or retried.

## Impact
Affected: `agents/lib/agent-loop.mjs`, new `agents/lib/tool-failure-diagnosis.mjs`, `agents/hands-off-agent.mjs` wiring. No new permission, runtime, planner or state store. Baseline: PR #233. Live missions on an installed Windows runtime are unobserved.
