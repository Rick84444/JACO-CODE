# Aura integrations: implementation and evidence

## Product contract

Integration identity comes from the configured account and workspace. No customer name, email, repository owner, price or published result is fabricated in the GitHub/Hugging Face integration flows changed here.

GitHub browser login uses the existing Git Credential Manager owner. JACO accepts no GitHub token through this GUI. A successful child process spawn means login started; it does not mean authentication completed. Stored account detection is separate from remote repository access and push/merge authorization.

Aura Tools (mobile: More -> Tools) provides integration cards for Git, workspace files, web research, the existing read-only Cloudflare adapter and Hugging Face. Observed tool discovery determines READY. The canonical MCP host now supports Streamable HTTP as well as stdio; no second tool engine is introduced.

Hugging Face uses the official `https://huggingface.co/mcp` service. Its credential selector stores only a reference to `HUGGINGFACE_TOKEN` or `HF_TOKEN` in the workspace MCP configuration. The service process must receive the selected variable through deployment secret configuration. Browser login to the Hugging Face website does not supply a credential to this transport. Anonymous discovery is supported when the service permits it. Reopening the panel reflects the persisted credential reference.

Custom remote servers can be configured through the existing workspace `.jaco/mcp/servers.json`:

```json
{
  "servers": {
    "example-service": {
      "name": "Example service",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "tokenEnv": "EXAMPLE_SERVICE_TOKEN",
      "enabled": true
    }
  }
}
```

This version does not implement automatic OAuth discovery/registration, server-initiated sampling, resumable SSE or a generic connection editor. Remote tools without a declared read-only annotation are denied. This annotation is a server claim, not independent proof of behavior. Connecting does not grant push, merge, deployment or paid-job authority.

The account endpoints `/api/huggingface/status` and `/api/huggingface/repos` are local-UI gated. Identity is observed through `whoami-v2`; repository queries use that observed account. Model, dataset and Space lists are bounded to 100 each and indicate possible truncation. Errors remain UNAVAILABLE rather than becoming successful empty results. Email, raw auth metadata and token values are excluded. Repository visibility is not mission acceptance or a published-product verification.

## Verification on 2026-10-05

- 58 focused Node tests passed: integrations, Hugging Face account projection, agent board, provider choice/registry, Ollama cloud budget, SEER chat and truthful GUI suites.
- TypeScript checks passed in source and installed runtime checkouts.
- Frontend Vite build passed; existing bundle-size warnings remain.
- Backend CommonJS esbuild bundle started successfully on isolated loopback port 3087 with separate disposable workspace state, no production missions or paid inference credentials.
- Browser desktop and 390x844 mobile: Tools panel opened; anonymous Hugging Face MCP connected and reconnected, reporting READY and four discovered read-only tools (`hf_whoami`, `hub_repo_search`, `hub_repo_details`, `hf_fs`). No LLM calls, paid jobs or repository uploads were performed.
- Failure tests cover missing credentials, TLS bypass rejection, HTTP authorization failure, invalid remote configuration isolation, Git login spawn failure, denied remote writes, absent account identity and upstream repository failures.
- Installed runtime GitHub status endpoint returned HTTP 200 and reported an existing stored GCM account. Actual interactive login completion and repository push/merge were not exercised.

## Delivery and runtime boundaries

The initial NOT_FOUND diagnosis found an old running process while the login route already existed on disk. Automatic approval review rejected the attempted Aura restart with `blocked by policy`; no stop/start occurred from that attempt. Later observation found a different running process and a working GitHub status route.

Scoped changes were merged into the installed checkout preserving its prior changes and secret/state files, with originals backed up in an external evidence directory. Its current running process predates the final Hugging Face account projection update. Restart the installed Aura service through its normal launcher, then reload the GUI to load the final changes. Source state, isolated bundled-runtime evidence and the installed process observation are distinct.

Workplace bootstrap and scoped claim preceded implementation. Workplace became unreachable on port 2995 during final verification; attempted re-registration failed with ECONNREFUSED. Final coordination state is DEGRADED_UNSYNCED. This document and local evidence provide the resumable handoff; a final Workplace handoff is pending availability.

No claim is made that the entire product is free of legacy personal defaults, ready for ISO distribution, verified on Android hardware or ready for public launch. Those require a separate release audit of the remaining product surface.
