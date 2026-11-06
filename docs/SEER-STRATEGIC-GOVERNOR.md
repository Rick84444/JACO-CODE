# Aura Strategy Function — Historical SEER Service Boundary

Aura is JACO's only operator-facing agent identity. The service historically named SEER owns the durable strategy and mission-graph implementation, not an independent agent persona. It does not replace the existing execution service, Workplace, ModelRelay, Desktop AgentOS, or the mission bus.

Canonical execution path remains:

`SEER -> Durable Nova Mission -> Desktop AgentOS / existing executor -> ModelRelay -> actuation surface -> verified receipt`

The Aura strategy function (implemented by SEER) owns:

- long-horizon purpose and invariants;
- strategic goals and beliefs;
- comparison of multiple candidate strategies;
- prediction/falsifier ledger and replan signals;
- empirical capability outcomes;
- economic outcome observations;
- strategic context exposed to agents.

The strategy function does **not** own:

- a second mission executor;
- a second desktop/browser control plane;
- direct financial authorization;
- implicit paid-model activation;
- claims of completion without evidence.

Financial candidates may be ranked by SEER, but execution remains gated by the existing ModelRelay signed autonomy mandate. No strategy service can self-authorize spend through its API.

The strategic kernel shares SEER's canonical SQLite database. Existing mission, memory, observation, experience, Nova routing and Workplace behavior remain available for compatibility while strategic state is added alongside them.

## Reality states

- **IMPLEMENTED**: strategic purpose, goals, beliefs, multi-candidate ranking, predictions/falsifiers, capability outcomes, economic observations, strategy API integration, Workplace Agent Card update.
- **TESTED**: deterministic strategy tests plus SEER runtime smoke test in GitHub Actions.
- **RUNTIME VERIFIED**: only after the target JACO host runs this master revision and produces real durable receipts through the canonical execution path.
- **NOT YET IMPLEMENTED**: automatic candidate generation/Hypothesis Engine experiments and Knowledge Object evolution across repositories. These should be added into this kernel rather than as parallel orchestration systems.
