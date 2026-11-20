# Delivery gates (not completed by the legacy Git-ref PR)

- [x] Locate existing Google-session and JACO Link tenant foundations.
- [x] Specify one-Aura / account-bound OAuth architecture and default-off rules.
- [x] Remove the developer's hardcoded repository from the legacy bridge.
- [ ] Implement per-account OAuth authorization code + PKCE and token services
      with verified redirect/client identity, resource indicator and revocation.
- [ ] Implement the shared hosted MCP endpoint and explicit tool profiles.
- [ ] Implement tenant- and device-bound MCP-to-JACO Link request bridging,
      bounded cross-tenant routing and replay protection.
- [ ] Build connect/status/revoke UX and consent scopes in JACO account portal.
- [ ] Verify private developer MCP connection and tool invocation on ChatGPT
      web first; this is not mobile support.
- [ ] Submit a reviewed, publishable JACO remote MCP plugin to the universal
      Plugins Directory; account OAuth and tool safety must pass review.
- [ ] Register/connect the JACO MCP plugin in ChatGPT through user action;
      verify both eligible mobile-app and desktop-chat sessions use the same
      account-bound tool scopes and paired Aura.
- [ ] Run a mobile ChatGPT conversation → submit harmless goal → receive
      canonical admission ID → poll durable mission → show verified tool
      receipt **within the same ChatGPT conversation**, no Termux/PWA switching.
- [ ] If phone OS actions are required, implement a separate optional
      Android companion with user-granted platform permissions and independent
      end-to-end receipts; do not hide this behind the PWA.
- [ ] Run OAuth negative tests, account A/B isolation, device revocation,
      expired grants, disconnected host and unknown-outcome reconciliation.
- [ ] Verify on two real Google accounts, two paired Aura hosts and two separate
      ChatGPT sessions; confirm no cross-account information or execution.
- [ ] Perform security review and production deployment with rollout opt-in.

**Launch blocker:** Do not merge/deploy this as if customer ChatGPT
connection were finished based only on green unit tests.
