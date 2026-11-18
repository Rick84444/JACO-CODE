# University research: adaptive human–agent interaction
Literature scan 2026-11-18; targeted, not systematic. No affiliation or endorsement implied.

## Evidence and transfer limits
- Ronanki (2025), FSE Companion, DOI 10.1145/3696630.3728717, https://research.chalmers.se/publication/548045. RACI role allocation, example implementation; work in progress, empirical validation planned. Transfer: operator accountability and existing policy boundaries.
- https://research.chalmers.se/publication/551472 (2026). Two-cycle design science research on trust requirements in an HR chatbot; domain-specific evidence, not validation of JACO.
- Yoon, Feldt, Yoo (2024), ICST, DOI 10.1109/ICST60714.2024.00020, https://research.chalmers.se/publication/542878. DroidAgent evaluated 15 apps: mean activity coverage 61% vs 51% baseline; 317/547 generated tasks judged relevant/realistic. Transfer: goal-oriented GUI scenarios plus independent assertions. https://github.com/coinse/droidagent README inspected; LICENSE path unavailable, do not copy until license verified. Targets APK/ADB, not directly a Chrome PWA harness.
- When Should Users Check? CHI 2026, DOI 10.1145/3772318.3790655. Controlled study N=48; intermediate checks reduced task completion time by 13.54%, 81% preferred them. Transfer: compare interruption schedules under existing mandatory approvals; effect size not transferable.
- https://gtc.inf.ethz.ch/research/digital-characters/interactive-avatars.html (ongoing ETH project): mesh rig, captured performances, speech and rendering under latency constraints. Reference architecture, not a portable dependency.
- https://cgl.ethz.ch/publications/papers/paperWit24b.php (EmoSpaceTime): separation of emotional expression and speech content. Transfer: independently control speech articulation and presentation animation.
- https://pantomatrix.github.io/BEAT/ (ECCV 2022): 76h paired motion, face, audio and language; noncommercial dataset. Research reference only, not a production asset.
- DialogLab, UIST 2025, DOI 10.1145/3746059.3747696, https://github.com/ecruhue/DialogLab. README and MIT LICENSE inspected; React/Vite/Express, turn-taking, animated avatars and real-time previews. Candidate for reuse of isolated presentation/test code, not its planner/server or third-party models; review exact revision and asset rights before adoption.
- https://os-world.github.io/ and https://webarena.dev/og/: execution-based task evaluation against configured environments, useful for independently checking agent outcomes rather than relying on textual claims.
- https://hai.stanford.edu/news/computational-agents-exhibit-believable-humanlike-behavior: observation, memory, reflection, planning and ablation. Different target task; not evidence of autonomous software delivery.
- Reflexion, NeurIPS 2023, https://github.com/noahshinn/reflexion (MIT LICENSE inspected). Verbal feedback stored in episodic memory. Candidate comparison for existing learning and reflection loop; no model weight improvement implied.

## Prospective studies
H1: context-aware optional notification scheduling lowers interruptions without increasing completion time or missing operator decisions. Compare chat-only, fixed interval and risk-aware; preserve mandatory approvals in all arms. Use matched scenario seeds, record completion, interrupt count, recovery time, time to decision, false/missed notifications; report failures and confidence intervals. Predefine utility weights; sensitivity analysis. Human study needs consent and ethics assessment where applicable.
H2: rigged mesh with separate viseme and expression channels improves blind-rated naturalness versus amplitude-driven baseline. Measure audio/visual alignment, p95 frame time and render failures on actual Windows and Android Chrome. Do not treat naturalness as evidence of agent competence.
H3: intent-driven test generation complements deterministic regression tests. Compare unique valid task coverage, reproducibility and fault detection against fixed tests. Isolated fixture accounts; execution-based assertions independent of generating model.
H4: reflection and selected memory retrieval improve task success at equal budget. Compare model-only, retrieval, retrieval+reflection on held-out tasks; count costs, latency, failed actions and regressions.

No experiments or integration executed in this literature-review change. Existing runtime ownership and approval policy unchanged.
