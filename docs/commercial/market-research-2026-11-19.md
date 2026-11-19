# Buyer-side market research — 2026-11-19

## Evidence and feasibility

Observed Jobbi report at 00:00 UTC: 670 open indexed records, 487 marked escrowed, 155 at least USD 50, median USD/USDC reward 20 among 527 priced records, 540 human-reviewed. Source: https://jobbi.org/gigs/report/. Not independent verification; duplicate, outdated, competitive, human-only and unfunded records may exist. No estimate of Aura's win rate follows from these counts.

| Source | Primary evidence | Actual connector boundary |
|---|---|---|
| Jobbi | https://jobbi.org/docs/mcp/ — read-only tools, hourly refresh, original URLs, reward/state/acceptance metadata | catalog + clock list_gigs/get_gig/list_sources; no hiring or payment |
| AgentGigs | https://www.agentgigs.io/docs/api — proposed price in cents, own application/funded details, earnings calculator, Stripe Connect human identity, upload and submit documented | existing application/reads and new estimate_payout for authenticated account, not deliver or settle |
| Frantic | https://gofrantic.com/docs/mcp — unauthenticated remote discovery, board/bounty/ledger only; https://gofrantic.com/charter documents funding and payout policy | new read-only discovery MCP, no claim/money; live tool list not observed on target |
| Bounty | https://docs.trybounty.ai/agents/how-it-works/ ; https://docs.trybounty.ai/agents/connect/ ; https://docs.trybounty.ai/agents/sdk/ ; https://trybounty.ai/terms — buyer-funded bids/claims, fee-free worker onboarding as stated, Sweden listed subject to Stripe approval | integration candidate, not configured or proven payouts |
| Algora | https://github.com/algora-io/algora/blob/main/priv/content/docs/payments.md ; https://github.com/algora-io/algora/blob/main/priv/content/docs/bounties/in-your-own-repos.md — Sweden listed, issue/PR and payout confirmation | Jobbi plus original GitHub issue; verify exclusive paid agreement before work, observe maintainer rules |
| IssueHunt | https://oss.issuehunt.io/ — open-source rewards through accepted PR; separate security-bounty product has separate rules | discovery via Jobbi, no automatic submission or security scanning |
| Upwork | https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly — unapproved browser/API automation risks suspension | operator-supplied listing or approved API only, no automated browsing/searching |
| Freelancer | https://www.freelancer.com/about/apiterms ; https://www.freelancer.com/feesandcharges — API scope and charges | manual/approved access review, not configured |
| Contra | https://contra.com/policies/terms ; https://help.contra.com/en/articles/9322763-paid-projects — contracts, processing/platform fees may apply | approved manual handoff, not configured |
| PeoplePerHour | https://support.peopleperhour.com/hc/en-us/articles/205217187-The-Basics ; https://support.peopleperhour.com/hc/en-us/articles/205218337-Freelancer-commission-fees — approved proposal and escrow before work, commission | approved manual handoff, not configured |
| Elgora | https://elgora.ai/ — winner-selected submissions and escrow | exclude speculative contest model by default |

## Business decision rules
Prioritize jobs with a funded exclusive assignment, measurable acceptance, supported payout country, no outgoing spend, non-sensitive input and low revision cost. Prefer ordinary coding, data conversion, testing, spreadsheet and API automation. The provider's listing/payout ledger is not independent evidence that Aura has been paid. Distinguish listing, application, assignment, funding, delivery, acceptance, platform release, bank settlement. Verify platform commission and fees, taxes, billable versus nonbillable hours; conservative contribution at low/base/high assumptions, not income forecasts. No subscriptions or token purchases.

For Swedish operators, official guidance: https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomster/tjansteruppdragochgigs/saljatjanster.4.6bef7d451695d90def448f6.html and https://www.akademikernasakassa.se/ersattningen/regler-och-villkor/uppdrag . Check own benefit/insurance and tax position before accepting paid work; no assumption unpaid or agent-operated business is exempt. Keep operator-specific details private.

## Falsifiable pilot
- Discovery: original listing linked, fresh status and terms, documented cost and deadline; no fabricated funding.
- First assignment: explicit funded exclusive engagement with allowed AI participation, agreed acceptance matrix and viable payout route.
- Delivery: independently tested artifacts, private workspace, operator-approved endpoint/payload; no speculative unpaid build.
- Settlement: independent confirmation of funds, actual variable costs and human time. Record rejected bids and failed outcomes as well.
- Compare first five qualified applications on allocation, hours, response, award, acceptance and settled contribution. Do not generalize from a sample of five. If no viable opportunities, revise targeting, not spend.

Evidence level: first-party public documentation inspected, index snapshot, not live authenticated provider calls. Implementation adds read tools only; external delivery and payout integration remain gaps. Current source and terms must be checked again before action.
