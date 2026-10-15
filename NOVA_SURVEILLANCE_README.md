  NOVA Surveillance System — Live Agent Monitoring
Status: Production Ready (v.)
Architecture: CDP Browser + NovaTractionEngine + WebSocket Streaming + Electron GUI
Purpose: Real-time visibility into autonomous agent execution
---
  What is Nova Surveillance?
Nova Surveillance is a transparent execution layer that shows exactly what an autonomous agent is doing:
```
┌─────────────────────────────────────────────────────────┐
│  NOVA SURVEILLANCE GUI (Electron)                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │  [Live CDP Feed]        [Traction State]          │  │
│  │  ┌─────────────────┐    ┌─────────────────────┐   │  │
│  │  │                 │    │ State: LOCKED       │   │  │
│  │  │  [Green Box]    │    │ Target: "Pay Now"   │   │  │
│  │  │  [Red Dot] ←    │    │ Confidence: .    │   │  │
│  │  │                 │    │ Reidentify:        │   │  │
│  │  └─────────────────┘    └─────────────────────┘   │  │
│  │                                                    │  │
│  │  [Tankeflöde — Agent Reasoning]:                   │  │
│  │  [THINK] Navigating to aacolony.com...           │  │
│  │  [DECIDE] Found registration form                 │  │
│  │  [TRACK] Target locked: "Register" button         │  │
│  │  [EXEC] Clicking at predicted position...         │  │
│  │  [OK] ✓ Registration complete                     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```
Key features:
-  Live Camera Feed — Real Chromium instance screenshot stream ( FPS)
-  Traction Box — Green bounding box around target element
-  Prediction Dot — Red dot showing where Nova will click next
-  State Machine — IDLE → ACQUIRING → LOCKED → VERIFYING → COMPLETE
-  Tankeflöde — Chronological log of agent decisions
-  Telemetry — FPS, confidence score, reidentification count, uptime
---
  Architecture
 Three Layers
```
┌──────────────────────────────────────────────────┐
│ LAYER : Electron GUI (nova-surveillance-main.js) │
│ - Displays live feed + overlay                    │
│ - Receives WebSocket streams                      │
│ - User controls (pause, kill)                     │
└──────────┬───────────────────────────────────────┘
           │ WebSocket
           │  : Screenshots (binary)
           │  : Traction state (JSON)
           ▼
┌──────────────────────────────────────────────────┐
│ LAYER : Nova Bridge (nova-surveillance-bridge)   │
│ - Isolated Chromium instance (CDP)               │
│ - NovaTractionEngine state machine               │
│ - Screenshot capture loop                        │
│ - Thought logging                                │
└──────────┬───────────────────────────────────────┘
           │ Chrome DevTools Protocol
           ▼
┌──────────────────────────────────────────────────┐
│ LAYER : Browser Engine (Headless Chromium)      │
│ - Isolated from user's browser                   │
│ - Runs autonomously                              │
│ - No interference with user's browsing           │
└──────────────────────────────────────────────────┘
```
 NovaTractionEngine State Machine
```
         ┌─────────┐
         │  IDLE   │
         └────┬────┘
              │ beginIntent()
              ▼
         ┌─────────────┐
         │ ACQUIRING   │ ← Searching for target
         └────┬────────┘
              │ acquireTarget(confidence ≥ .)
              ▼
         ┌─────────┐
         │ LOCKED  │ ← Target found & tracked
         └────┬────┘
              │ beforeAction()
              ▼
        ┌──────────┐
        │ VERIFYING│ ← Action in progress
        └────┬─────┘
             │ markActionComplete()
             ▼
        ┌──────────┐
        │ COMPLETE │ ← Done
        └──────────┘
   (On target loss: LOCKED → REIDENTIFYING → RECOVERING)
```
---
  Quick Start
 Installation
```bash
 Clone repo
git clone https://github.com/Rick/nova-agent.git
cd nova-agent
 Install dependencies (includes puppeteer + ws)
npm install
 For GUI: also install electron
npm install --save-dev electron
```
 Run Surveillance
Option : Bridge only (headless)
```bash
npm run surveillance
```
Output:
```
[NOVA SURVEILLANCE] Initialized. Streams ready:
  - Screenshots: ws://...:
  - Traction state: ws://...:
```
Option : GUI only (need bridge running in another terminal)
```bash
npm run surveillance:gui
```
Option : Full stack (bridge + GUI in parallel)
```bash
npm run surveillance:full
```
---
  WebSocket API
 Screenshot Stream (port )
```javascript
const ws = new WebSocket('ws://...:');
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  // e.data is PNG binary
  const blob = new Blob([e.data], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  // Display as image
};
```
Stream rate: ~ FPS (ms interval)
 Traction State Stream (port )
```javascript
const ws = new WebSocket('ws://...:');
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'traction') {
    console.log('State:', msg.state);
    // {
    //   state: 'LOCKED',
    //   target: {
    //     semanticPurpose: 'Register Button',
    //     confidence: .,
    //     lastBbox: [, , , ],
    //     source: 'vision'
    //   },
    //   trackId: 'TRACK--abc',
    //   events: [
    //     { at: '--T::.Z', type: 'intent.started', message: '...' },
    //     { at: '--T::.Z', type: 'target.acquired', message: '...' }
    //   ]
    // }
  } else if (msg.type === 'thought') {
    console.log(`[${msg.level}] ${msg.message}`);
  }
};
```
Stream rate: ~ Hz (ms interval)
---
  How Traction Tracking Works
 . Begin Intent
```javascript
traction.beginIntent('Find and click "Pay Now" button', 'payment_submitted');
// State changes to ACQUIRING
```
 . Acquire Target
```javascript
traction.acquireTarget({
  semanticPurpose: 'Pay Now button',
  text: 'Pay Now',
  role: 'button',
  bbox: [, , , ],
  confidence: .,  // CV model confidence
  source: 'vision'
});
// If confidence ≥ ., state changes to LOCKED
```
 . Observe & Reidentify
```javascript
traction.observe({
  timestamp: '--T::.Z',
  app: 'browser',
  semanticTargets: [
    { text: 'Pay Now', role: 'button', bbox: [...], confidence: . },
    { text: 'Cancel', role: 'button', bbox: [...], confidence: . }
  ]
});
// Engine matches new targets against locked target
// If match score ≥ .: stays LOCKED
// If match score < .: transitions to REIDENTIFYING
```
 . Execute & Verify
```javascript
traction.beforeAction('click at ,');
// State changes to VERIFYING
// Action executes (click, type, etc)
traction.markActionComplete();
// State changes to COMPLETE
```
---
  Integrating with Nova Agent
 Option A: Use as CLI Tool
```bash
 Start Nova agent in discover mode
npm run discover
 In another terminal, start surveillance
npm run surveillance:gui
```
 Option B: Embed in Nova Agent Code
```javascript
// agents/nova-autonomous-agent.mjs
import { NovaSurveillanceBridge } from './nova-surveillance-bridge.mjs';
const bridge = new NovaSurveillanceBridge();
await bridge.initialize();
// When agent navigates to marketplaces:
await bridge.navigateAndTrack('https://aacolony.com', 'register');
// When agent finds targets:
await bridge.detectTargets('Pay Now button');
// When agent clicks:
await bridge.executeClick(, );
```
 Option C: With Hands-Off Agent
```javascript
// agents/hands-off-agent.mjs integration
const surveillance = await nova.browserSurvey('marketplace_registration');
const traction = new NovaTractionEngine();
// Survey results feed traction engine
traction.observe({
  semanticTargets: surveillance.record.elements,
  expectedTransitionObserved: false
});
// Click execution confirms traction
if (traction.state === 'LOCKED') {
  await nova.click(selector);
  traction.markActionComplete();
}
```
---
  Event Log Format
Each decision generates an event in the traction state:
```json
{
  "at": "--T::.Z",
  "type": "intent.started|target.acquired|target.tracked|target.reidentified|action.started|action.complete|transition.verified",
  "message": "Human-readable description"
}
```
Event types:
| Type | Meaning | Example |
|------|---------|---------|
| `intent.started` | Agent begins a goal | "Find and click 'Register'" |
| `target.acquired` | Target element located | "Button confidence=." |
| `target.tracked` | Target confirmed in observation | "Button still visible" |
| `target.reidentified` | Target lost and refound | "Button reidentified after scroll" |
| `target.lost` | Target not found in observation | "Re-identifying..." |
| `action.started` | Action about to execute | "click at ," |
| `action.complete` | Action succeeded | "Click executed" |
| `action.blocked` | Action prevented | "Blocked: confidence too low" |
| `transition.verified` | Expected UI change confirmed | "Payment modal appeared" |
---
  Troubleshooting
 "Cannot connect to ws://...:"
→ Bridge is not running. Start with `npm run surveillance`
 "No screenshots appearing"
→ Bridge crashed. Check console logs:
```bash
npm run surveillance >& | tee bridge.log
```
 "Traction box not appearing"
→ Target detection is failing. Check:
. Is page loaded? (check screenshot feed)
. Are elements on page? (open DevTools on CDP browser via CDP protocol)
. Is confidence high enough? (check telemetry: needs ≥. to lock)
 "GUI is black/blank"
→ Canvas is not receiving screenshots. Check:
. Bridge is running (`npm run surveillance`)
. Screenshot WS connection is open (check browser console)
. Port  is not blocked by firewall
---
  Performance
Baseline metrics (on modern hardware):
| Metric | Value |
|--------|-------|
| Screenshot FPS | ~ FPS (ms capture) |
| Traction state updates |  Hz (ms) |
| Memory usage (bridge) | ~ MB |
| Memory usage (GUI) | ~ MB |
| CPU usage (idle) | <% |
| CPU usage (streaming) | ~-% |
Optimization tips:
. Reduce screenshot rate → Edit `nova-surveillance-bridge.mjs` line: `setTimeout(stream, )` for  FPS
. Disable DevTools → In `nova-surveillance-main.js`, remove `mainWindow.webContents.openDevTools()`
. Lower resolution → In `nova-surveillance-bridge.mjs`, reduce viewport to x
---
  Security Notes
-  Isolated Chromium — No interference with user's browser
-  Local WebSocket only — Binds to ... (localhost only)
-  No credential storage — Screenshots streamed in real-time, not saved to disk
-  Open source — Full code available for audit
---
  Example: Full Workflow
```bash
 Terminal : Start surveillance bridge
$ npm run surveillance
[NOVA SURVEILLANCE] Initializing...
[NOVA SURVEILLANCE] Initialized. Streams ready:
  - Screenshots: ws://...:
  - Traction state: ws://...:
 Terminal : Start Electron GUI
$ npm run surveillance:gui
[NOVA GUI] Electron app started
 Terminal : Run Nova agent (your code)
$ node agents/nova-autonomous-agent.mjs --mode discover
[NOVA] Navigating to aacolony.com...
[NOVA] Found  elements
[NOVA] Target locked: Register button (confidence: .)
[NOVA] Clicking...
```
GUI shows:
. Live feed of aacolony.com page
. Green box around "Register" button
. Red dot showing click prediction
. Telemetry: FPS=, Confidence=%, State=VERIFYING
. Tankeflöde logs each step
---
  Production Deployment
For production agents, surveillance can be:
. Always-on for monitoring — Run bridge + GUI on agent server
. On-demand for debugging — Start when issues occur
. Headless (bridge only) — Stream to remote monitoring dashboard
---
Status: Ready for launch
Version: ..
Last updated: --