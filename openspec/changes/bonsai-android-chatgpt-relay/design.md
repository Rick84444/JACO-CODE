# Design

ChatGPT private MCP (operator task)
→ \`jaco_aura_android_bonsai\` (private Aura tool)
→ JACO Core \`POST /api/relay/android-bonsai\` (authenticated)
→ existing AutonomyMandateStore and Android actuator lease
→ local Bonsai llama.cpp \`127.0.0.1:9380/v1\` (structured one-action JSON)
→ existing HandsOffClient → paired native Android Accessibility
→ existing before/after hash receipt → bounded receipt to ChatGPT.

**Not** wired through the public Git-ref Workplace relay, which has communication-only authority. The model cannot call the Android bridge directly. The Core server controls all actual calls and grant lifetime.

One mission permits a single allowed Android package and maximum 20 steps (default 8). The local planner sees at most 120 accessibility nodes without password-field values. Only \`open_app\`, \`tap\`, \`type_text\`, \`scroll\`, \`back\` and \`home\` are admissible; a unique selector and unexpired grant are required. Native enforcement is authoritative even if the model misbehaves.

No synthetic physical-Android evidence is provided by these tests. Model inference and tap accuracy depend on Bonsai's actual JSON compliance, foreground app behavior, battery/system memory and Android permissions.

## Tradeoffs
- Generic Android view semantics rather than OCR/screenshot, because the existing native accessibility tree is safer and already integrated.
- Bounded synchronous task endpoint for MVP; no new queue, background worker or stale autonomous retries.
- Only local Core/Android transport: expanding to Windows host needs explicit integration with the existing device pairing and durable Mission Bus, not new public ingress.
