# Local startup UX requirements

## ADDED Requirements

### Correct package version banner
The root npm package and its lockfile MUST identify the same runtime version as `runtime/package.json` for the 0.23.1 checkout. The version string MUST NOT be taken as evidence of a production release or a completed runtime activation.

### Startup without manually managed gateway secret
If the canonical local startup has no configured gateway token, it MUST generate and persist a strong unique local credential before starting any HTTP service, then provide it privately to all dependent services. No operator manual token setup SHALL be required.

#### Scenario: fresh clone
Given valid dependencies and a fresh configuration with no gateway token, when the canonical startup acquires its exclusive startup lock, it generates the credential once and services use the same value.

#### Scenario: explicit short token
Given a configured invalid credential, the startup fails with a diagnostic instead of silently replacing or bypassing the credential.

#### Scenario: read-only status
Given no gateway token, invoking preflight or status does not generate tokens.

### Security controls retained
Local HTTP tools that mutate files, browsers, desktops or missions MUST NOT become unauthenticated by this change. External exposure, remote relays, spending and destructive actions retain their authorization requirements.
