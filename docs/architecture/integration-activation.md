# Integration activation findings

The canonical encrypted SecretStore is consumed by ProviderRegistry. Saving through
`/api/aura/workbench/secrets` now refreshes provider registrations immediately.
Explicit provider scans also refresh registrations so keys saved by another agent
process become discoverable without restarting. Registration is not authentication:
a rejected credential still reports KEY_REJECTED. No inference call is added.

The older AuraEngine vaultItems collection is separate in-memory state. It is not
a provider credential source and must not be presented as durable provider setup.
No automatic migration is implemented: service names in that collection are not
necessarily valid credential identifiers. Do not send keys through chat to migrate.

URL skills install into the workspace skill directory and are available through
existing skill list/load/run routes. Installation alone does not run a mission.
CDP needs a reachable debugging browser, and a cloud IDE needs its actual address
and authenticated pairing. A healthy runtime or a stored URL is not evidence of
those connections. External computer/cloud setup remains environment-specific.

Validation: 26 provider-registry, connection-setup and skill-runtime tests passed;
runtime TypeScript passed. The new regression verifies a credential saved after
startup is discovered by scan and a rejected key remains rejected without leakage.
No user's device, credential validity or remote connection was verified.
