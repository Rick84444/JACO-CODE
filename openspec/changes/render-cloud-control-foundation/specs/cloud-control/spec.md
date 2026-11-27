## ADDED Requirements
### Requirement: Canonical customer cloud transport and durable handoff
JACO Cloud SHALL reuse the existing JACO Link protocol and one tenant/device-bound cloud handoff owner on Render. It SHALL preserve the separate private Cloudflare operator path and one local Aura runtime. Mission acceptance SHALL NOT imply dispatch or completion. PostgreSQL uniqueness and compare-and-swap SHALL prevent duplicate admission and blind retries. Tenant identity SHALL originate from trusted authorization and completion SHALL require independent evidence verification. No cloud control endpoint SHALL grant unrestricted local shell access.
#### Scenario: Unknown delivery
- WHEN a network delivery outcome is unknown
- THEN the durable record remains unknown until an authenticated paired-host receipt resolves it, without blind retry.
#### Scenario: Unconfigured cloud
- WHEN trusted identity or evidence dependencies are absent
- THEN customer control SHALL fail closed and SHALL NOT claim readiness.
