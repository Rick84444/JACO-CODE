# Operator opt-in for raw keyboard and mouse on a physical host

## Problem

Aura's virtual keyboard and mouse (`mouse-*`, `key-press`, `type-text`) are released by Desktop AgentOS only inside a verified
Hyper-V guest (`JACO_AURA_DESKTOP_SANDBOX=hyperv-guest`). The operator's machine is a physical Windows 11 Home PC, where
Hyper-V cannot be installed, so the tools the operator built can never be used there.

## Scope

- A second explicit mode, `JACO_AURA_DESKTOP_SANDBOX=host-operator`, together with `JACO_ALLOW_COORDINATE_FALLBACK=1`.
- The interactive-session checks stay identical to the guest mode. Only the Hyper-V guest probe is skipped.
- Every raw action on a host additionally needs a fresh verified `desktop-observe` of the target window whose process is in
  the operator's desktop grant list (`JACO_DESKTOP_GRANT_PROCESSES`, default list of the standing grant).
- No new tool, executor or agent. Credential/logon processes remain blocked by the grant surface, `vault:` and secret-like text
  is still refused by `rawInput`.

## Acceptance and falsifier

Acceptance: with both variables set on Windows and a verified interactive session, `virtualInputGrant` allows raw input with
reason `OPERATOR_HOST_OPT_IN`; `hostInputTargetAllowed` allows only observed windows of granted processes. Falsifier: either
variable alone, a non-Windows platform, a locked desktop, an unobserved or ungranted window (`lsass`, `1password`), or an
unknown mode value yields an allowed grant.

## Non-goals

Changing the Hyper-V route, the Nova executor's own raw-input path, mouse input without a screenshot receipt, or granting any
surface the desktop grant blocks.
