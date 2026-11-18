# Startup stop propagation audit

Source inspection of main: agents/lib/local-stack.mjs, agents/lib/startup-evidence.mjs, agents/jaco-cli.mjs, gateway/src/workplace/workplace-agent-supervisor.mjs, agents/lib/planner-choice.mjs.

## Findings
- activate starts Workplace before Core and awaits enabled services serially; waitReady defaults to 180 seconds and throws to the outer BLOCKED handler. Chrome has isolated failure handling but tunnel and generic service failures do not.
- Both launcher and supervisor set JACO_WORKPLACE_REQUIRED=1. Trace actual consumers before changing this contract; do not launch duplicate SEER/Nova workers.
- inspectStatus uses every service READY; launcher maps warnings to DEGRADED but CLI maps any non-READY to exit 1. Browser evidence reconciliation also forces report.ok false. Separate core readiness from capability completeness consistently.
- CLI skips activation if runtimeUp succeeds, which can leave partial startup unrepaired. Re-resolve endpoints after port reassignment and use canonical data root for evidence.
- Supervisor has shared restart timer/backoff; inspect call paths and test whether failures interfere before introducing per-capability recovery.
- Missing token fails prior to checkpoint; reuse setup token generation under safe locking, preserve invalid explicit credentials as actionable errors. Emergency stop stays fail closed.
- Process ownership uses Windows birth time; non-Windows pending process record cannot prove ownership. Never terminate unknown processes.

## Required experiments
1. Inject failure in each optional service separately; Core and unrelated missions remain available.
2. Inject Workplace, SEER, Nova and provider failures separately; record actual dependency matrix and ensure no duplicate worker or unauthorized fallback.
3. Re-run start with Core already up but missing workers; verify repair and no duplicate process.
4. Inject stale receipt, occupied port, process exit before readiness and concurrent activation; verify bounded completion and evidence consistency.
5. Test mission DAG: unavailable capability blocks only dependent nodes, independent nodes continue, unknown external effects are reconciled before retry, emergency stop remains global.

All findings are static inspection, all experiments pending. No production changes or claims of target-host verification.
