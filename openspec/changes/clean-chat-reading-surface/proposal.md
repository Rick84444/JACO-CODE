# Clean conversation reading surface

## Problem
The operator reported that chat replies cannot be read because the interface is filled with status and activity overlays. In the existing UI, conversation focus is still a 40%-width split pane on desktop and landscape Pixel widths, while AuraOverview, activation reports, autonomy controls, mission activity and a decision card consume most of the available vertical space.

## Approach
Make conversation focus truly full-width independent of viewport width. Keep operator and assistant messages as the default chat transcript; make runtime activity available in a bounded details panel and existing Stage/Evidence views. Collapse diagnostics, autonomy controls and blocking decision details into clearly labeled, keyboard-accessible summaries. Do not change execution, approval, payment or state ownership.

## Acceptance
- Conversation focus occupies the entire workspace reading area with no canvas visible at portrait and landscape sizes
- Actual assistant replies are rendered directly and no runtime activity cards interleave them
- Technical activity, approval and control actions remain accessible and no mission data is deleted
- Short windows maintain a scrollable response area and a usable composer
- Typecheck, focused tests and affected UI gates pass
