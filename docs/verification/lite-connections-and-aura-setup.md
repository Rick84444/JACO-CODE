# Lite connections and Aura setup assistance

Implemented in the existing Lite launcher, JACO Editor MCP, Workplace, provider SecretStore and Aura prompt builder. No parallel agent runtime or model-specific planner was added.

## Behavior

- Lite starts its own loopback Workplace and opens `/connect.html`.
- The guide configures project MCP for Claude Code/VS Code or user MCP for Codex. Existing files receive backups; existing JACO entries and malformed configuration require review.
- A real JACO Editor `project` call verifies runtime/Workplace connectivity. This does not prove an external client has loaded its configuration.
- An explicitly selected top-level project `.env` file can supply catalogued model-provider keys to the existing encrypted store. Values stay out of HTTP receipts and model context. Existing stored keys and unrelated credentials are preserved.
- Import/configuration endpoints use the existing local same-origin guard. Remote IDE sessions cannot invoke them.
- Aura offers one setup step at a time, requires consent for secret import, leaves interactive login to the user and separates diagnostic observation from system/model changes.

## Executed evidence

- 18 focused tests: Lite packaging/launcher, connection configuration, selected secret import and Aura bridge/prompt contracts passed.
- 13 website tests passed.
- Clean source snapshot client/server builds completed. Concurrent SEER/mission changes were excluded.
- Isolated Lite started on port 3107; Workplace identity and MCP inclusion observed.
- Browser guide executed `project` successfully against the isolated test project.
- Separate stdio MCP process initialized, enumerated real tools and executed `project` successfully.
- Unconfirmed secret import returned ENV_IMPORT_CONFIRMATION_REQUIRED; cross-origin request rejected.
- A second extracted-package check found identity version lookup using project cwd and accidental local-stack CLI execution in bundled Nova. Both were corrected before publication.
- Final extracted ZIP started on port 3109. Identity returned HTTP 200/version 0.22.0; Nova logged runtime=true and Workplace READY without the spurious startup CLI error.
- 14 startup safety/observation tests also passed.
- Public jacocode.com ZIP returned HTTP 200 and SHA-256 88ff30d96194ba72a4d313c4217e0aa145126065023fcb208fed53db3203a594, matching the tested package.

## Limits

Aura changes are runtime instructions, not fine-tuned model weights or proof that every model will follow them. Nova-specific secret import delegation, automatic CDP login, OS optimization and model installation are not newly implemented here. Aura falls back to the secure guide when a dedicated secret tool is unavailable. Cloud requires an operator-configured authenticated remote endpoint and device pairing; the guide does not expose the computer automatically. External Codex/Claude/VS Code sessions must reload and approve MCP themselves.
