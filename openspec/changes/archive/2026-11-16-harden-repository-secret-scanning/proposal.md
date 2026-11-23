# Harden repository secret scanning before public contributions

## Why

Current secret tests skip `tests/` and some tracked file types, and the runtime
preflight scanner runs from the current working directory. Real credentials
inside fixtures or other tracked files could pass despite the no-secrets policy.
The public Git relay additionally needs an explicit rule against publishing
private content.

## Changes

- Unify the tracked-file secret audit with deterministic, type-aware detection.
- Inspect every Git-tracked text file, including tests and fixtures, without
  per-directory exemptions. Ignore only proven binary files.
- Preserve masking behavior in tests while constructing synthetic secrets at
  runtime, so fixtures do not themselves contain key-shaped credentials.
- Make the audit fail closed when Git/file inspection cannot complete.
- Run the security audit on every pull request and main push before merge.
- Document that a current-tree scan does not prove old history is clean.

## Falsifier

Commit a key-shaped string in a test fixture or another non-exempt text path
and run the audit. It MUST fail and name only the path and key type, never the
credential. Remove the value, rerun: it MUST pass. Missing Git state MUST not
be silently treated as success.

## Safety

No credentials are created, printed or rotated. No operator-specific host
details, private values, paid tools or new privileged runtime are required.
History audit and key rotation remain separate incident-response activities.
