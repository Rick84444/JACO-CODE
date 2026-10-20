# Agent coordination through Aura

JACO is the coordinating agent the operator meets through Aura. SEER remains the
single owner of planning, dependencies, checkpoints and replanning. Nova executes
assigned work under its existing contracts. Aura presents those facts and sends
operator goals through the existing start-goal route.

The Agents tab extends the existing agent board. Its default view is a selectable
constellation; the mission/result board remains available beside it. The operator
can inspect a sphere's goal, plan, dependencies, children, actual executor and
receipts, or give the coordinator a new goal. Search, plan filtering, pagination
and zoom keep larger teams navigable.

## Agent identities

Three kinds of execution participants are deliberately distinguished:

- Connected agents come from observed Workplace identities and sessions.
- Execution processes come from the durable bus worker registry and heartbeats.
- Task agents are durable SEER graph-node contexts, with their own objective,
  dependency state, inherited authority and budget. A task agent is not an extra
  operating-system process. Multiple contexts can share the Nova executor.

The central coordinator sphere represents the configured SEER responsibility.
It is marked unavailable if its health cannot be observed. An empty or unreachable
source is never presented as a successful team with no remaining work.

## Adaptive delegation

The existing planner can request a selective replan with meaningful specialist
names and measurable objectives when decomposition helps the goal. This is not a
mandatory team template. SEER persists the replacements and their `delegatedFrom`
relationship in the existing node strategy. This supports nested delegation and
survives restart without introducing another agent registry or mission store.

Dispatch carries a descriptive task-agent identity into Nova and its model
context. Identity is not authority: scope, allowed tasks and budget still come
from the existing execution contract. Splits retain and divide the available
budget, and the final replacement retains the original acceptance obligation.
Unknown outcomes and missing authorization are not grounds for blind delegation.

## Evidence and conversation

`/api/aura/workbench/agent-board` combines the safe agent-board projection with
read-only SEER graph and health observations. It returns typed relationship kinds:
connection, delegation, dependency and observed execution binding. Only a real
binding connects a live executor to a task agent. Missing bindings remain unknown.

Aura's `agent_team` tool reads this same projection. Ordinary questions can inspect
the team without creating agents, restarting work or acquiring mutation tools.
Plans and next steps are public operational state, not private model reasoning.
Tool receipts remain distinct from independently verified goal completion.

The constellation is paginated and bounded source windows are labeled. It never
uses random agents, canned plans or decorative activity as evidence of cognition.

## Verification

The agent-network regression covers nested delegation, restart persistence,
inherited budgets, dispatch identity, model context, executor binding and secret
redaction. Rendering tests exercise the constellation and unavailable sources.
These checks do not establish autonomous planning quality with a real model or
visual usability on a physical device.
