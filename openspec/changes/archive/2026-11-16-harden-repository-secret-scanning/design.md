# Design

Owner: existing repository secret controls in
`tests/nova/repo-has-no-secrets.test.mjs` and
`runtime/scripts/verify_secret_patterns.mjs`.

A central source scanner will consume Git's tracked-path index rather than a
hand-maintained allowlist. Each file is read as bytes and classified as text or
binary; unreadable tracked files are errors, not ignored. Patterns detect
well-known GitHub, OpenAI, AWS, Stripe, Slack, Google, Cloudflare, HuggingFace,
and private-key indicators. Results contain file path and category only. CI
runs the scanner on checkout with read-only permissions.

The second existing runtime audit reuses this scanner. Synthetic token
fixtures are formed at runtime from fragments; the test assertions continue
to verify actual masking without checking test-token literals into Git.

This change detects repository content in the current ref and staged files; it
does not certify the entire reachable Git history. A history scan and rotation
plan are explicitly called out for the operator. The public Git-ref message
contract MUST never contain plaintext private content.

Acceptance: current checkout reports no detections, fixture injection is
detected in tests, both scanner entrypoints agree, and CI is green on the PR.
