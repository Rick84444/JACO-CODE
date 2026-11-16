# Security policy

## Report a vulnerability

Please report it privately, not in a public issue:

- GitHub: use **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- email `hello@jacocode.com` with "JACO security" in the subject.

Include what you found, how to reproduce it, and which version or commit. You will get an answer as soon as a maintainer can read it; this is a small project, so there is no guaranteed response time. Please give us a reasonable time to fix a problem before you publish it.

## What is in scope

- The runtime and IDE server, agents, Workplace, JACO Lite, and the jacocode.com Worker.
- Unauthorized tool calls, secret leakage into prompts/logs/receipts, workspace escapes, and encryption/device-token weaknesses.

Out of scope: poorly configured external services and threats requiring control of the host account.

## How JACO handles secrets

- API keys are kept outside the project (`~/.jaco`), sealed with AES-256-GCM; the co-located key file protects against accidental disclosure, not host compromise.
- Tool results are masked before a model sees them (`agents/lib/secret-capture.mjs`).
- Jaco Drive stores end-to-end-encrypted ciphertext.
- The repository-wide source scanner checks Git-tracked and publishable untracked text files, **including tests and example files**, for recognizable credential formats. It fails closed on unreadable tracked files and does not print matches. Run `node runtime/scripts/verify_secret_patterns.mjs`; CI runs the same check on pull requests to `main`.
- Synthetic credentials used by tests are assembled in memory rather than stored as ready-to-use token-shaped literals.

**Limitations:** A clean current-tree scan cannot prove the absence of credentials in old commits, tags, forks, releases, Actions logs or private local files. Signature-based scanning can also miss unknown credential formats. Before publishing or after suspected exposure, audit all reachable history separately (e.g. with a maintained history-aware secret scanner such as Gitleaks), review GitHub's security alerts, and **revoke/rotate any leaked key** before considering history cleanup. Removing the latest copy alone does not revoke it.

Git-ref relay messages and public control/status branches are public data: do not send passwords, raw private conversations, customer data, host secrets or bearer credentials through them. Never assume an ACK is proof of an authenticated live chat session.

## Supported versions

Only the current `main` and latest JACO Lite download receive fixes.
