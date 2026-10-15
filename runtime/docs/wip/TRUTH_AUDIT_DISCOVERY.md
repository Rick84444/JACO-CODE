# JACO 0.19 WIP — Truth Audit Discovery

**Status: discovery scan, not adjudicated findings.** A hit is not automatically a defect; random IDs/nonces are legitimate. Each runtime-facing use must be classified before release.

| Pattern | Files containing pattern |
|---|---:|
| `Math.random` | 40 |
| `[REAL]` | 66 |
| `SIMULATED` | 9 |
| `mock` | 8 |
| `VERIFIED` | 42 |
| `placeholder` | 48 |

## High-priority manual review candidates

- `src/server/state/aiCoreBridge.ts` — random/dummy embedding path.
- `src/server/agentHubService.ts` — randomized latency/content paths.
- `src/server/integrations/mimirPowerService.ts` — randomized proof/invoice/latency-like values.
- `src/auraEngine.ts` — randomized proof/order/access-key-like values.
- `src/components/LiteRTTelemetryChart.tsx` — generated NPU/GPU/CPU/temperature/TPS display values.
- `src/components/LiteRTNpuChatPanel.tsx` — generated NPU load/temperature/TPS values.
- `src/components/AutonomousAutopilot.tsx` — randomized connector/test outcomes.
- `src/components/AgentMcpDiscoveryHub.tsx` — legacy MCP UI/spec wording must be migrated to official v2 gateway status.

## Release rule

Every runtime-visible datum must carry one of: `VERIFIED_PHYSICAL`, `VERIFIED_TEST`, `IMPLEMENTED_UNVERIFIED`, `SIMULATED`, `UNAVAILABLE`. No simulation or deterministic fallback may be rendered as `REAL`/`VERIFIED` without evidence.
