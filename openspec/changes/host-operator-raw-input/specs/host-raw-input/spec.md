# Host raw input — additive requirements

## ADDED Requirements

### Operator opt-in on a physical host
With `JACO_ALLOW_COORDINATE_FALLBACK=1` and `JACO_AURA_DESKTOP_SANDBOX=host-operator` on Windows and a verified interactive
session, Desktop AgentOS MUST allow raw keyboard and mouse tasks only for a window observed in the same mission whose process
is in the operator's granted process list. Any other mode value, missing variable or unverified session MUST refuse.

#### Scenario: ungranted process
- Given host mode and a fresh observation of a `lsass` window
- When the mission issues `type-text` to that window
- Then the task is refused with `HOST_INPUT_PROCESS_NOT_GRANTED`.
