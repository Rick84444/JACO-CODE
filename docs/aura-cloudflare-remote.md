# JACO Remote — chat-led Cloudflare access to the Windows Aura runtime

**Implementation:** source-level Remote PWA and canonical workbench presentation; **live Cloudflare, phone and Windows acceptance are not verified by this change**.

## Boundary and architecture

Phone browser / installed Remote PWA → HTTPS → Cloudflare Access → Cloudflare Tunnel → **JACO Core on Windows** (`127.0.0.1:3000`) → the existing Aura chat, strategy graph, mission bus, tools, memory and approvals.

There is **one Aura**. This is not an Android agent, a Termux environment, an additional backend, a replicated database or a remote desktop/screen-streaming implementation. The phone and PC issue commands through the same origin-relative `/api/aura/*` endpoints and read the same persisted mission state. Closing the phone must not cancel the mission; stopping a mission still uses the canonical mission action. Do not route the phone directly to LM Studio, Ollama, CDP 9222, shell, or the Workplace internal ports.

The Remote presentation is `/?remote=1`: conversation first; **Mission**, **Plan**, **Results**, **Decisions**, plus a link to the full IDE. Existing runtime success and error receipts remain the source of truth. Remote presentation does not grant or modify any permission.

## Windows + Cloudflare setup

1. Start JACO on the Windows PC using the canonical installed launcher (`JACO-start.vbs` or `npm run jaco:start`). Confirm Core is actually responding on the configured loopback port; the examples below use **3000**, but do not assume it if a different `PORT` is set.
2. In Cloudflare, set up a **named Tunnel** attached to the operator-controlled domain. Add a **published application route** for the intended remote host (for example `ide.example.com`) with service URL **`http://127.0.0.1:3000`** (or the observed Core port). Do not publish other JACO internal services.
3. In Cloudflare Zero Trust, configure a **self-hosted Access application** for the same hostname with an explicit allow policy for the operator's identity, denying everyone else. Verify unauthorized browsers are challenged by Access **before** reaching the local login page. Tunnel by itself publishes an endpoint and is not an authorization layer.
4. On Windows set `JACO_IDE_PUBLIC_HOST=ide.example.com` using the **actual** hostname, without `https://` or a trailing slash. This existing host gate rejects a proxy host mismatch. Keep the existing local Core and gateway authentication intact.
5. Run **one** `cloudflared` connector on Windows. If using JACO's existing locally-managed tunnel launcher, set `JACO_START_TUNNEL=1` and the correct private `JACO_TUNNEL_CONFIG` (default `logs/cloudflared-config.yml`); otherwise manage `cloudflared` as a Windows service using Cloudflare's tunnel token and leave JACO's tunnel autostart off. Do not start two connectors for the same installation unintentionally. Never commit the token, credentials file or config secrets.
6. At the **local** JACO IDE open **Devices → Add device → Browser**, enter a device name and generate a single-use pairing code. On the phone open the Devices-provided URL of the form `https://ide.example.com/ide-login?next=remote`. Sign in with the code, then the browser opens `/?remote=1`. The device key is stored in the existing secure, HttpOnly session cookie and can be revoked in Devices.
7. In the phone browser choose **Install app** / **Add to Home screen**. The Remote manifest has its own ID and starts directly in the chat-led Remote view. Existing full JACO IDE installations retain their original manifest and start URL.

**Same-origin transport:** the browser uses the same host for UI and API requests. Do not hardcode `api.jacocode.com` into the client or weaken same-origin/CSRF checks. The existing remote IDE gate requires the configured host, signed pairing cookie and the correct HTTPS Origin for mutations; shell/terminal routes remain local-only. Cloudflare Access is an additional perimeter, not a replacement for JACO pairing and approval controls.

## Release acceptance — observe on the actual machine

- Anonymous phone visit → Cloudflare Access challenge. Authorized but unpaired phone → JACO pairing page. Arbitrary host → 403.
- Valid single-use code → Remote view; expired/replayed code rejected. Revoked device → further API calls blocked.
- Android 390×844 viewport and installed PWA: chat is readable and keyboard does not obscure send. Mission, Plan, Results and Decisions work; scrolling does not leak past the viewport.
- Send a real chat message, inspect the response from the Windows runtime, then create a permitted mission. Confirm identical mission ID and status in the PC IDE and Remote view; inspect actual receipts rather than relying on a decorative connected indicator.
- Disconnect the phone during an active mission, reconnect, and verify the same durable mission can be inspected/steered/stopped without duplicate writes.
- Remote `POST /api/terminal/exec` returns 403; local-only commands, model credentials and CDP ports remain private. Confirm Cloudflare Access policy and HTTP/WebSocket behavior during network changes.
- Build/typecheck, test IDE gate/remote link and UI rendering on PC; record Windows + mobile/browser results separately. Passing unit tests is **not** proof that the tunnel or Cloudflare Access is currently configured.

## Disable / rollback

Remove or disable the published Cloudflare hostname and Access application, stop the connector, set `JACO_START_TUNNEL=0` if JACO was managing it, and revoke the phone's device key in the Windows Devices panel. The original local `/` IDE, Aura and persisted missions remain unchanged.

Cloudflare's current guides: [Tunnel](https://developers.cloudflare.com/tunnel/get-started/), [private web app + Access](https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/private-web-app/).
