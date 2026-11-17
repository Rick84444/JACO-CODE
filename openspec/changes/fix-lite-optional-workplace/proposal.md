# Fix false Workplace and optional service blockers in Lite

## Why
The local Lite launcher overrides the direct executor's optional Workplace policy with JACO_WORKPLACE_REQUIRED=1. A failed coordination startup or sync can therefore prevent unrelated local work. Lite does not ship standalone SEER or the ChatGPT Nova gateway; unavailable optional listeners are misreported as failures. The public Git-ref relay belongs to Workplace, not those listeners.

## What changes
- Default only the isolated local Lite launch to optional Workplace coordination; retain explicit strict mode and existing local session/mission authorization.
- Propagate the actual selected Workplace port and distinguish absent Lite services from failed required services.
- Teach Aura to scope blockers to the requested capability and verify relay receipts separately.
- No removal of remote authentication, Git write authorization, session identity, spend limits or execution contracts.

## Acceptance and falsifier
A missing optional service does not stop unrelated local tasks; a required Workplace failure still stops strict startup. A public Git relay is not reported READY without evidence. Remote credentials and authenticated session checks remain unchanged.
