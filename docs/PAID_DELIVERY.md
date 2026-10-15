# Paid delivery: from Stripe checkout to a working call

Until now a buyer could pay through a Stripe payment link and still get 402 on every call, because
nothing turned a payment into access. This is the missing step.

```
Stripe payment link -> checkout.session.completed -> jaco-license worker -> key in KV
                                                          |
buyer lands on /success?session_id=... and reads the key  |
                                                          v
POST https://<skill>.workers.dev/run   with header  X-JACO-Key: jaco_live_...
```

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `jaco-license` worker | `scratchpad/workers/patched/jaco-license.js` | Verifies the Stripe signature, issues one key per checkout session, shows it on the success page |
| `LICENSES` KV namespace | Cloudflare | `key:<key>` holds product, call quota and usage; `sess:<id>` maps a checkout session to its key |
| 12 skill workers | `scratchpad/workers/patched/a2a-*.js` | `POST /run` accepts `X-JACO-Key` (or a RapidAPI proxy secret), counts the call down and reports `calls_remaining` |
| Tests | `tests/workers/license.test.mjs` | Signature rejection, replay safety, quota exhaustion, wrong-product refusal |

Run the tests with `node --test tests/workers/license.test.mjs`.

## Operator setup (once)

1. **KV namespace**
   ```
   npx wrangler kv namespace create LICENSES
   ```
   Bind the id as `LICENSES` in `jaco-license` and in every `a2a-*` worker.

2. **Deploy**
   ```
   npx wrangler deploy scratchpad/workers/patched/jaco-license.js --name jaco-license
   ```
   Then redeploy the 12 skill workers so they pick up the key check.

3. **Stripe webhook secret**
   ```
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --name jaco-license
   ```
   The value comes from Stripe Dashboard -> Developers -> Webhooks after adding the endpoint
   `https://jaco-license.<subdomain>.workers.dev/stripe/webhook` for the event
   `checkout.session.completed`.

4. **Product map** — which payment link grants which skill and how many calls:
   ```
   npx wrangler secret put PRODUCT_MAP --name jaco-license
   {"plink_xxx": {"product": "a2a-smart-contract-auditor", "calls": 25}}
   ```
   Payment link ids are shown in Stripe under Payment Links. An unmapped link still delivers a
   working key (`product: "all"`, 25 calls) rather than leaving a paying customer with nothing.

5. **Success URL on every payment link** (Stripe -> Payment Links -> After payment):
   ```
   https://jaco-license.<subdomain>.workers.dev/success?session_id={CHECKOUT_SESSION_ID}
   ```

## Notes

- Keys are consumed per call. KV is eventually consistent, so a buyer can in theory squeeze a few
  extra calls out of parallel requests; it is not a billing ledger, it is access control.
- The webhook never returns the key in its response body, only a prefix for the log.
- Revenue bookkeeping in the runtime (`/api/stripe/webhook`) is separate and unchanged.

## Deployed state (2026-09-17)

Storage is a Durable Object inside `jaco-license`, not KV: the account token has no KV permission,
and a single DO instance also makes quota counting atomic, so two parallel calls cannot spend the
same last credit. The skill workers reach it through a service binding (`LICENSE_SVC`) with a shared
secret in `LICENSE_INTERNAL_SECRET`; a worker fetching the public workers.dev URL of another worker
in the same account fails, which is why the binding is required.

Deployed through the Cloudflare REST API (`scratchpad/deploy-workers.mjs` in the session scratchpad),
because wrangler rejects account-owned tokens.

Live and verified end to end: webhook with a bad signature is refused, a paid session issues exactly
one key, a replayed webhook reuses it, the success page shows it, `/run` spends one call at a time,
the quota runs out, a key for another skill is refused, and an unknown key is refused.

Remaining operator steps in Stripe:

1. Add the endpoint `https://jaco-license.dickjacobsson022.workers.dev/stripe/webhook` for
   `checkout.session.completed` and put its signing secret in `STRIPE_WEBHOOK_SECRET`
   (currently a placeholder, so real Stripe events would be rejected).
2. Set the success URL on every payment link to
   `https://jaco-license.dickjacobsson022.workers.dev/success?session_id={CHECKOUT_SESSION_ID}`.
3. Set `PRODUCT_MAP` so each payment link grants the right skill and quota.
