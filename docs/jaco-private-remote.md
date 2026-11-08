# JACO Private Remote — no Cloudflare Tunnel

## Goal

Keep the canonical **Windows JACO CODE Full** installer and a single Windows-hosted
Aura runtime. Android is only the existing chat-first Remote PWA, not a Termux
agent and not another repository/memory/mission owner.

```text
Windows JACO CODE Full (127.0.0.1:3000)
    └─ Tailscale Serve HTTPS (tailnet-only)
            └─ Phone browser / JACO Remote PWA
                    └─ existing IDE pairing cookie → same Aura and missions
```

This is the **practical first private transport** replacing the Cloudflare
Tunnel dependency. A future hosted **JACO Link** outbound relay could eliminate
the need for a VPN app on the phone. No JACO Link relay or central hosting is
implemented or asserted by this PR.

## Operator experience

1. Install and launch **JACO CODE Full** on Windows normally. Windows installer
   still installs the actual Node runtime, creates Start Menu entries and keeps
   state under `%LOCALAPPDATA%\JACO`. Installers do **not** start or authorize
   remote access automatically.
2. Install and sign in to **Tailscale** on Windows and Android, connecting both
   to the same *private tailnet*. Enable MagicDNS and HTTPS for the tailnet.
   Use the official clients: https://tailscale.com/download/
3. In the Windows Start menu launch **JACO Private Remote Setup** after JACO
   Core is running. The script checks local JACO identity, active Tailscale
   membership and the Serve HTTPS URL before writing settings. It uses private
   `tailscale serve --bg http://127.0.0.1:3000` — **not Funnel**.
4. Restart JACO CODE so the locally preserved environment loads the configured
   `JACO_IDE_PUBLIC_HOST`. This is the full Tailscale DNS hostname, not a
   Cloudflare domain. Check `tailscale serve status` and JACO Devices.
5. On Windows open **Devices → Add device → Browser**. Choose a short name and
   generate the single-use pairing code (10-minute expiry).
6. On Android, while signed in to Tailscale, open the HTTPS Remote pairing link
   displayed in Devices, enter the code, then choose *Add to Home screen*.
   Android sees the same Aura missions and chat; it does not run tools locally.

The Windows setup script does not install Tailscale silently, log in on behalf
of the operator, change a public DNS record, or create an Internet-facing
endpoint. No Cloudflare account, tunnel ID, service token, or JacoCloud installer
is needed for this private transport.

## Security and truth boundaries

- Tailscale Serve is tailnet-only; its device and network access rules apply.
  `tailscale funnel` is intentionally not used or enabled.
- Browser Remote still requires the **independent JACO device pairing**,
  HttpOnly+Secure+SameSite cookie, exact HTTPS Origin for mutations, and the
  same canonical mission, budget and approval restrictions as Windows.
- A direct LAN connection without proxy headers is not a privileged local
  session. The IDE gate treats non-loopback source addresses and non-local
  Host headers as remote (including WebSocket upgrades). Shell/terminal routes
  remain local-only.
- Core, LM Studio, Ollama, Workplace and CDP ports must not be externally
  exposed, forwarded by the router or bound for general Internet access.
- JACO is usable locally even when Tailscale or the phone is offline; an
  ongoing durable mission is not stopped by phone disconnection.
- Private HTTPS DNS names may appear in certificate transparency logs; avoid
  sensitive computer names. Tailscale is a third-party network dependency.
- **[REAL]** Windows setup scripts, installer integration and source tests
  are committed. **[UNKNOWN]** Tailscale account consent, actual Windows
  invocation, phone pairing, private network connection, and reconnection
  until physically tested. CI builds are not proof of user-device availability.

## Recovery and rollback

The optional setup script makes a timestamped backup of
`%LOCALAPPDATA%\JACO\.env` before modifying the public-host setting. Restore
that setting (or remove `JACO_IDE_PUBLIC_HOST`) and restart JACO to disable the
private link on JACO's side. Revoke the phone device from **Devices**. Stop the
Tailscale Serve route using `tailscale serve --https=443 off` **only if no other
application is using that HTTPS route**; never reset unrelated Serve services.
The installed local Aura, ledger, models and project state remain untouched.

## Acceptance on real Windows + phone

- Full Windows installer copies the setup script, Start Menu command launches.
- Without Tailscale installed, no remote configuration is written.
- Without a live local Core, no remote configuration is written.
- Serve must report the expected private HTTPS host and local proxy target.
- Anonymous phone → 401/IDE login; wrong hostname → 403; replayed code fails.
- Paired phone → chat and actual mission receipts match the Windows IDE.
- Terminal action from phone → 403; signed-out/revoked phone loses API/WS.
- Disconnect/reconnect phone → same mission ID, no duplicate mutation.
- No public Internet access, no Tailscale Funnel, no new JACO cloud account.
- Do not publish a stable Windows release before green native installer CI
  and a clean-host acceptance including Windows Defender/SmartScreen behavior.

Official references:
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/reference/tailscale-cli/serve
