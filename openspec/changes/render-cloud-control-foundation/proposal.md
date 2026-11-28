# Render JACO Cloud foundation

Reuse the existing Cloud handoff and PostgreSQL contract from PR #355 on current main, rather than merging its unrelated divergent runtime changes. Follow the existing ADR `docs/architecture/RENDER_CLOUD_PRIVATE_CLOUDFLARE_BOUNDARY.md`. Preserve the existing private Cloudflare control, JACO Link wire contract and sole Aura runtime. The first slice is a source transplant, not a hosted service.
