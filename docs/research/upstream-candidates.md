# Upstream candidates — preliminary screening

- https://github.com/gepa-ai/gepa (MIT per repository): reflective Pareto optimization; first candidate for offline bounded strategy/skill optimization. Reproduction artifact: https://github.com/gepa-ai/optimize-anything-artifact. Never optimize authorization, evaluator or constitution. Separate train/validation/test; compare against random/best-of-N at equal budget.
- https://github.com/stanfordnlp/dspy : optional comparison for prompt optimization, not a replacement runtime.
- https://github.com/MineDojo/Voyager (MIT per repository): executable skill library and feedback patterns; Minecraft-specific, not a direct dependency.
- https://github.com/tigerless-labs/agent-memory (MIT per repository): compare selective consolidation, no additional canonical store.
- https://github.com/swarm-ai-research/blf-forecaster : inspect belief calibration; forecasting-specific and unverified license.
- https://github.com/lilishyxf/AgentTraceLab : inspect held-out trace evaluation; license and actual implementation pending.
- https://github.com/hamza-dev-tech/agent-memory-bench : compare memory baseline, verify license and dataset terms.

No upstream imports yet. Pin revisions, confirm licenses and transitive dependencies, inspect source/test code, run isolated tests, then adapt to existing canonical interfaces. Search results and reported benchmarks are not independent verification. Hz is not a quality metric. No separate runtime, no production activation. Reject additions that fail matched-budget held-out evaluation or contract safety checks.
