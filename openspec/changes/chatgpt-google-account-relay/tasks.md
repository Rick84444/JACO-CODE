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
- [ ] Register/connect the JACO MCP plugin in ChatGPT through user action.
- [ ] Run OAuth negative tests, account A/B isolation, device revocation,
      expired grants, disconnected host and unknown-outcome reconciliation.
- [ ] Verify on two real Google accounts, two paired Aura hosts and two separate
      ChatGPT sessions; confirm no cross-account information or execution.
- [ ] Perform security review and production deployment with rollout opt-in.

**Launch blocker:** Do not merge/deploy this as if customer ChatGPT
connection were finished based only on green unit tests.
