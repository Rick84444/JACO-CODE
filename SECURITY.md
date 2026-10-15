# Security policy

## Report a vulnerability

Please report it privately, not in a public issue:

- GitHub: use **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- email `hello@jacocode.com` with "JACO security" in the subject.

Include what you found, how to reproduce it, and which version or commit. You will get an answer as soon as a maintainer can read it; this is a small project, so there is no guaranteed response time. Please give us a reasonable time to fix a problem before you publish it.

## What is in scope

- The runtime and IDE server (`server.ts`, `JACO-Cognitive-Runtime-*`), the agents (`agents/`), Workplace (`gateway/`), the JACO Lite download (`lite/`, `tools/build-lite.mjs`) and the jacocode.com Worker (`site/`).
- Bypasses of the limits JACO states: an agent running a tool or command it was not allowed (`agents/lib/approval-policy.mjs`, `agents/lib/safe-shell.mjs`, MCP access settings), leaking a secret into a log, a receipt or a model prompt, reading outside a workspace, and weaknesses in Jaco Drive's encryption or device tokens (`site/drive.mjs`).

Out of scope: a service you configured yourself with a weak key, attacks that need control of the machine JACO runs on, and findings in third-party providers.

## How JACO handles secrets

- API keys are kept outside the project (`~/.jaco`), sealed with AES-256-GCM; the key file sits next to them, so this protects against accidents, not against someone who can read your user account.
- Tool results are masked before a model sees them (`agents/lib/secret-capture.mjs`).
- Jaco Drive is end-to-end encrypted on the device; the server stores ciphertext only.
- The tracked repository must contain no keys. The Firebase *web* API key in `firebase-applet-config.json` is a public client identifier by design; access is controlled by Firebase security rules, not by hiding it.

## Supported versions

Only the current `master` and the latest JACO Lite download receive fixes.
