# Aura first: the Operator Stage as the local start page

## Problem
The operator wants to feel Aura as an agentic presence: talk with her, see which tools she uses while she works, and follow her strategy. The IDE shows all of this, but spread over many panels; in chat Aura also could not finish real work (a twelve-call ceiling, a browser contract that refused every keystroke, and a fallback chain that outlasted the GUI's own timeout).

## Solution
- **Operator Stage** (`runtime/operator-stage/`): Aura's existing 3D rig in the middle with the conversation (the IDE's own encrypted chat session). Beside her, glass holograms of the strategy board (gameboard plan steps; a blue line opens into the observed actions of the running step), her browser (live frame, enlarge, open the page in a real window) and her tool calls. A panel lights up while she uses it or talks about it (`[[jaco:focus …]]`, an extension of the existing workspace directives), she looks at it and back at the operator. Voice: replies read aloud, talk mode with browser speech recognition.
- **Served by the runtime** at `/` on this computer; the IDE is unchanged at `/ide`. A remote IDE session and a release without the stage files keep the IDE at `/`. Startup readiness checks the IDE at `/ide` first.
- **Aura's voice**: Microsoft's neural Swedish voice (Sofie) first, by operator choice (the spoken text is sent to Microsoft); local Piper Alma remains the fallback.
- **Chat that can work**: one 240 s budget per chat turn across all fallbacks; 20 tool calls per answer, and work beyond that continues as a durable mission through the existing `start_goal`; the browser facade requires the page address Nova already required, and the chat fills it from the current page; screenshots no longer raise Aura's window over the operator's GUI.

## Acceptance / falsifier
`/` on loopback serves the stage and `/ide` the IDE with HTTP 200 and no redirect; startup readiness is READY. Aura's rig renders under the runtime CSP (no inline script). A chat search on Google types into the search box and reports the first result. A chat turn never exceeds 240 s. If the stage invents tool activity, the beam or glow appears without a real receipt, the chat can mutate anything the IDE chat cannot, or a remote session reaches the stage, the change fails.

## Out of scope
New authority, new planner or mission store, new tool registry. A screenshot or headless run does not establish the operator's own browser, microphone or audio behaviour.
