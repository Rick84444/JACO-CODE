# Design

`virtualInputGrant` accepts `host-operator` as a second sandbox mode after the session checks and returns
`{allowed:true, mode:'host-operator', reason:'OPERATOR_HOST_OPT_IN'}` without the WMI guest probe. `desktop-agentos` calls
`hostInputTargetAllowed` for raw tasks when the mode is `host-operator`; the process name is read from the verified
`desktop-observe` receipt of the exact `expectedHwnd`, never from the task. Default list = `DEFAULT_DESKTOP_PROCESSES`.

Risk: raw keyboard and mouse act on the real desktop. Mitigations: explicit two-variable opt-in, off by default, process fence,
existing 30 s freshness of the observation, existing mission-task allowance and signed mandate, existing blocked-process list.
