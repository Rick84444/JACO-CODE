# Canonical Aura resolution and SEER strategy synchronization

## Why
SEER directly confirms a verified graph child before Core's claim review and selected operator policy. Core uses the 40-receipt context window for verification. Single-node repair can restore spent budget and replace the original scope.

## Change
Core alone resolves automatic mission completion after current policy, graph binding, and evidence checks. SEER projects the durable outcome. Reuse the existing mission event log for proofs; keep the small model context. Repair retains original contract and remaining allocation. Pending operator action is not a repairable graph failure.

## Falsifier
A SEER request confirms a child before Core review; an unbound/cancelled/manual graph is automatically confirmed; evidence is erased from verification after 40 turns; an old action is duplicated; a repair widens scope or renews consumed budget.

## Research
Chalmers, Understanding Conversational Patterns in Multi-agent Programming (2026), https://research.chalmers.se/en/publication/553034
Locating Hidden Failures Makes Long-Horizon Agents More Reliable (2026), https://arxiv.org/abs/2609.17930
OpenHands goal controller and stuck detection, https://github.com/OpenHands/software-agent-sdk/issues/4380
LangGraph interrupt checkpoint semantics, https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/types.py
Patterns adapted, not copied; no additional runtime dependency.
