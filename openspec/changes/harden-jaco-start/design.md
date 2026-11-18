# Design

## Ownership
Extend local-stack orchestration, setup dependency preparation, existing startup-evidence and runtime identity. Trace CLI and jaco-ctl callers first. Android and VS Code consume the canonical runtime status; preserve existing supported Termux behavior.

## Decisions
- Separate required dependencies from optional capabilities after mapping actual consumers; do not blindly remove Workplace requirement.
- Use bounded retry/backoff and process ownership checks; never kill foreign listeners or replay unknown external actions.
- Preserve valid credentials and explicit configuration. Missing local token can be generated securely; invalid explicit credentials must produce safe repair guidance, never an authentication bypass.
- Use existing identity and evidence interfaces for readiness. No new state store.
- Install/build only when necessary, using lockfiles and existing setup. Avoid silently downloading models or incurring costs.

## Experiment
Baseline exact main SHA, Windows environment and configured provider. Hypothesis: consolidated startup improves cold-start success without weakening security. Falsifier: any false READY, unauthorized operation, lost mission, or failed required cold start. Compare baseline and candidate on same host/config; record duration and exit codes. Require ten consecutive cold starts and an injected owned-service failure/recovery; distinguish controlled tests from real Windows observations.
