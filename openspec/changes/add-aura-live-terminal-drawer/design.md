# Design — on-demand Aura Live Terminal

Owner: `runtime/src/components/JacoAuraComputeIDE.tsx` instantiates a single panel using the existing `useCognitiveLive()` events. `CognitiveWorkspace` owns the toolbar/menu presentation. `AuraLiveStage` stops mounting its old inline `AuraTerminal`, but retains the non-terminal "What Aura is doing" goal overview and evidence.

- **Activity (default):** reuse `humanChatEvents` and `auraActivityFeed` for scoped, folded narration with timestamps and outcome labels. Show only observed updates, with bounded history and connection status; follow newest by default, disable follow on user scroll, offer resume-follow.
- **Commands:** reuse `AuraTerminal` as a read-only view of the current mission's actual `terminal` receipts and stdout/stderr. Command execution remains exclusively in the IDE code terminal through its existing endpoint.
- **Presentation:** a right-edge responsive panel available from the top toolbar and Remote navigation, closable via header/Escape. On narrow screens use a panel sized to keep the close button and tab controls reachable. No hidden permissions.
- **Authority:** no new EventSource, state store, URL or transport. Existing mission ID, event provenance and permissions remain canonical. The panel must not infer verified results from progress text.

No duplicate `AuraTerminal` remains in the stage. Zero server changes.
