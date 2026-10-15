# JACO Remote Actuator

Status: proposed implementation branch, not yet proven on a live operator device.

## Decision

Remote is the preferred default for whole-app autonomy. CDP remains a specialist browser actuator for DOM-level browser tasks and test diagnostics.

The runtime contract is:

```text
SEER -> durable Nova mission -> Remote Bridge -> ModelRelay -> Desktop/Android Hands-Off -> verified receipt
```

Remote Bridge must not bypass ModelRelay. A remote action is only successful when the downstream surface returns a verified receipt.

## Why not make Chrome Remote Desktop the agent API?

Chrome Remote Desktop is useful as the operator-visible transport, but it is not a semantic automation API. If an agent drives pixels over a remote screen without UI Automation or Android accessibility evidence, JACO cannot prove completion. That creates false autonomy.

Remote Bridge therefore exposes only semantic operations:

- status from runtime, relay and hands-off surfaces
- read-only observation
- signed actions through ModelRelay
- verified receipts from Desktop/Android Hands-Off

## CDP pattern reused

The Remote Bridge intentionally reuses the safer parts of the CDP bridge:

- loopback-only server
- bearer token authentication
- browser origin denial
- strict MCP input schemas
- bounded request bodies
- timeouts
- mutation gate
- `outcomeUnknown` on failed mutations

It does not reuse CDP as the execution mechanism.

## External references

Useful implementation references, not vendored code:

- microsoft/playwright-mcp: MCP browser automation using accessibility snapshots instead of screenshots.
- appium/appium-uiautomator2-driver: Android native, hybrid and mobile-web automation through UiAutomator2 and W3C WebDriver.
- openatx/uiautomator2: Python wrapper around Android UiAutomator2 and adb communication.
- pywinauto/pywinauto: Windows GUI automation using Win32 and Microsoft UI Automation backends.

## Verification gates

Remote is not considered operational until all are true:

1. `/health` reports only liveness and does not claim browser/app verification.
2. `/mcp` requires bearer auth.
3. Mutation tools fail closed unless `JACO_REMOTE_ALLOW_MUTATIONS=1`.
4. Remote status is ready only when ModelRelay single-writer is available and at least one real surface is observed.
5. A real mission completes through Nova and stores a verified receipt that cannot be forged by the caller.
