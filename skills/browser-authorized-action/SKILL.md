---
name: Authorized browser action
description: Execute permitted web forms and GUI operations through TARGET TRACK (browser/CDP) and LASER VISION, with exact approval, safe input, readback, evidence and recovery. Swedish klicka fylla formulär.
tasks: [web-fetch, mcp-call, mcp-write, skill-load]
---

# Authorized browser action

Aura is the sole mission owner. Reuse the current CDP MCP facade, Nova input engine, action journal, mandate checks, Mission Bus and evidence receipts. This procedure is not authorization. A skill cannot add permissions, approve its own actions or alter platform rules. Never use alternative OS input or shell/browser automation to get around a rejected CDP operation, bot restrictions, access controls, or a required human decision. The purpose of slow visual cursor motion is operator observability, not hiding automated input.

## Execute a bounded permitted workflow

- Load browser-workflow-understanding where available and follow its preflight. Inspect official channel rules before any outreach, submission or content publication. If a service does not permit automated or AI-generated participation, do not perform that participation, including via mouse or clipboard. Do not impersonate independent users, inflate votes or metrics, or make false declarations of human authorship. Offer permitted read-only evidence gathering or a human handoff.
- Verify live configured server and action availability with the existing MCP catalog and exact active mission scope. For a pinned, already observed and authorized control, use the existing verified browser actuator without redundant model-level surveys; its fresh target checks happen inside the actuator immediately before dispatch. For an unknown target, inspect with `target_track({target:'...'})` if advertised in Aura chat or with the existing `nova_observe`/`nova_ax` mission tools. If the origin, target, account, content or intended consequence changed, stop that external action and reassess.
- For outward or consequential effects (sending, posting, submitting applications, uploads, purchases, permission changes, destructive actions or account commitments), obtain the existing operator authorization bound to the exact target, content and consequence before dispatch. A generic mcp-write capability or an approval for a different action is insufficient. A prior approval is valid only when the canonical policy explicitly covers this exact operation and is still active. For payments and legal commitments use their separate existing approval channels. If a required approval cannot be verified through the runtime, do not dispatch; present a human handoff instead. Do not rely solely on UI labels or connector method names to identify the consequence.
- Resolve the real tool names in the catalog; use the authorized MCP read or write mode. For a permitted unique control prefer nova_click_named with role and name, or nova_click with a unique selector; use nova_type_named or nova_type only with authorized non-secret field values. For each identified write use the existing durable actionId and expectedUrl as required by its live schema; use expect for a fresh observable click postcondition where supported. For scroll or keys use only existing authorized capabilities and recognize that Enter can submit a form. Do not use guessed coordinates or dispatch raw scripts as a workaround.
- Before final submit, compare the actual visible form preview/field readback to the approved payload: recipient/destination, content, attachments, relevant terms, price/currency and other consequences. Missing values are not permission to improvise. Respect the platform's disclosure and rate rules. Leave fields that demand personal/human attestation to the operator. A preview is not proof that no network write occurred.
- After the permitted action, independently read the new page state and confirmation; distinguish accepted, validation failed, refused, not dispatched and outcome unknown. For public posting verify the actual post link/identifier and correct audience when authorized; for uploads verify filenames and intended destination; for applications check recorded status; for payments defer to independent financial settlement evidence. An input acknowledgment or a generated receipt ID is not acceptance.

## ChatGPT callback through an already signed-in account (human handoff)

Aura may use this **existing browser skill**, not a second ChatGPT relay
or another agent, to help an operator return to an already signed-in
ChatGPT conversation. This is a human-facing fallback while the supported
account-bound JACO MCP Events connector is unavailable.

- The operator owns the signed-in browser session and explicitly selects
  the destination account/conversation. Never attempt to log in automatically,
  use stored credentials, read cookies, copy bearer tokens, impersonate an
  account or attach to a different user's profile. No manual API key is needed.
- A pending `aura_call_requested` event contains only a generated
  `eventId`, canonical `missionId` and a short
  allowlisted reason. Use the current JACO Link account scope and device
  pairing. Duplicate event IDs are idempotent; conflicting mission bindings
  are rejected. Never include vault contents, full mission context or
  confidential source code in the callback prompt.
- DOM TRACK and Laser Vision are **observability aids** only where the
  website's current terms and permissions allow them. They do not grant
  consent, an authenticated ChatGPT integration or a right to extract
  ChatGPT output. Do not programmatically scrape responses or automate a
  ChatGPT consumer-web interface to bypass supported integration channels,
  subscription limits, anti-bot challenges or service terms.
- Prepare a short, inspectable operator handoff containing the event and
  mission IDs and the non-sensitive support question. Let the operator choose
  the ChatGPT conversation, review and send the prompt themselves. Do not
  click Send or read back generated ChatGPT output as an autonomous relay.
  Reuse the exact approved handoff record instead of creating a new mission,
  prompt/agent persona, browser controller or alternate memory.
- A prepared prompt is `HANDOFF_READY`, never `CHATGPT_CALLED`
  or `DELIVERED`. If the operator has not confirmed an actual
  supported response, keep the JACO Link call `PENDING_CHATGPT_SUBSCRIPTION`
  or explicitly `AWAITING_OPERATOR`. Never re-send an
  ambiguous prompt or resume a state-changing mission from an unverified
  browser observation.
- **Preferred automated route:** JACO's one authenticated HTTPS MCP plugin
  uses per-account authorization and an MCP Events subscription in clients
  that support it. Only verified webhook acknowledgment and an observed
  response can advance delivery and completion; a live ChatGPT tab alone
  does not prove an agent or conversation was awakened. Do not advertise
  consumer Android app event wake-up unless independently verified.

## Recovery, stop and memory

When a field is invalid, use the visible error text to correct only the permitted information; recheck approval if content or consequence changes. For a stale target resolve it again before any input. After a potential dispatch with timeout, unknown receipt or missing postcondition, reconcile against an independent read-only state; never issue a fresh actionId just to retry an ambiguous external write. Respect pause, cancellation and expired mandates. Do not repeat CAPTCHA, anti-bot, account or policy rejections through another path.

Use existing mission receipts to report actionId, approved intent reference (no raw secrets), origin, observed state, expected vs actual consequence and status. Summarize a reusable lesson with evidence and verification status through canonical memory ingestion if available; keep private user details out of public source and learned general procedures. If storage or browser verification is unavailable, say so rather than claiming success.
