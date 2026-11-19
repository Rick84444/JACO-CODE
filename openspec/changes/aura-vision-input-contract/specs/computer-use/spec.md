## ADDED Requirements

### Requirement: Grounded computer observation and truthful input dispatch
Aura SHALL consume only current mission-attested visual evidence, and native input SHALL report accepted dispatch or an explicit failure, not assert an application outcome.

#### Scenario: Stale frame or target
- WHEN an intervening action or stale observation invalidates the frame
- THEN the planner SHALL not receive that image as current evidence
- AND Track SHALL require fresh identification before action.

### Requirement: Window-bound raw input and independent effect evidence
The existing mission receipt SHALL bind raw input to an observed HWND, PID and geometry. Dispatch SHALL refuse absent or stale binding, a mismatched foreground/PID, invalid DPI context or an occluded pointer target; drift detected after dispatch SHALL report an unknown outcome. ROI observations SHALL NOT assert semantic postcondition verification.

#### Scenario: Foreground or target changes
- WHEN the actual window fails a pre-dispatch check
- THEN the input event SHALL NOT be submitted
- WHEN the foreground fails the post-dispatch check
- THEN the result SHALL report outcomeUnknown and SHALL NOT claim verified dispatch.
