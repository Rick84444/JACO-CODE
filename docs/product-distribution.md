# JACO local Cognitive OS and public entry

Status: operator direction / SPEC. This document records product intent and observed boundaries; it does not certify an ISO, deployment or business model.

## Product boundary

The product is a local Cognitive OS: one Cognitive Runtime owns execution, durable state, repository intelligence, knowledge, tools and policy. The IDE is its interface. Users can connect their own local or cloud LLMs; provider credentials, model capabilities and prices are configuration. Website delivery must not create a second autonomous executor or send private projects to a shared public runtime.

`jacocode.com` is the public brand and planned website. During inspection on 2026-10-05 its Cloudflare zone had no apex/www web address and no Worker routes. The active remote entry configuration was `ide.jacocode.com` and `api.jacocode.com` through the existing tunnel to the operator's local machine. A fresh public IDE request was denied until the runtime's configured IDE host matched this ingress. Remote IDE access remains paired/authenticated; terminal execution remains local. These are current-installation observations, not deployment defaults.

## Free entry and paid options

The intended free entry is a useful local IDE/runtime with user-supplied LLM connections and visible budget policy. The website should explain what runs locally and what an optional cloud request transmits. A public demo or download does not grant visitors access to the operator's local instance.

Possible paid extensions are advanced product capabilities, team coordination/support or optional managed API capacity. Pricing, entitlements and billing are undecided. Any future managed API needs its own tenant isolation, credential scope, usage ledger, cost limits and verified billing path before it can be sold. Do not advertise subscriptions or capabilities that have not been delivered.

## Nova demonstration

Use a short recording of a real bounded task showing: goal, Nova's next action, actual code change, test execution and verified result. Record in a dedicated demo repository with synthetic/public data. Remove private files, credentials, browser account details and unrelated mission content before publication. Capture/upload/website placement remains pending; no substitute animation is evidence of autonomous execution.

## ISO acceptance

The ISO track targets a local distribution. Selection of the underlying OS and installer remains unresolved. Before an ISO can be called shipped it must boot in a VM and on the target hardware, establish local permissions, persist repositories and knowledge, start the canonical runtime without an assistant, recover from reboot, enforce cloud budget, and support a tested update/rollback path. Current evidence covers Windows startup, production server restart and budget persistence only.
