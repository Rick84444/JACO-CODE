# JACO Skill Runtime

Canonical runtime for executable JACO skills.

A skill is not an agent and not a marketplace listing. It is a versioned package containing compact metadata, optional just-in-time instructions, a machine-readable procedure graph and executable adapters supplied by the host runtime.

## Package layout

- skill.json — always-cheap metadata and contracts.
- SKILL.md — model-facing instructions loaded only after retrieval.
- procedures/*.json — deterministic procedure graph.
- scripts/ — optional deterministic implementation code owned by the skill package.
- references/ — optional just-in-time documentation.
- tests/ and benchmarks/ — package-local verification assets.

## Runtime lifecycle

search -> resolve metadata -> load instructions if needed -> execute procedure -> durable checkpoints -> resume after failure.

The A2A skill registry remains the distribution/trust boundary for peer packages. It is not the canonical cognitive skill runtime. Marketplace catalogue entries likewise remain product metadata rather than executable skill definitions.

## Candidate compilation

SkillCompiler can distill two or more successful trajectories with the same action topology into a CANDIDATE package. Variable action arguments become explicit inputs. Compilation does not mark a skill ACTIVE and does not manufacture verification evidence.


## Skill Machine

The next execution layer compiles semantic Skill IR into the best available backend instead of hard-coding a skill to one tool.

Canonical ISA operations currently include:

OBSERVE, LOCATE, READ, WRITE, ACTIVATE, TRANSFORM, EXECUTE, WAIT, ASSERT, COMPARE, SELECT, CALL, RETURN, RECOVER.

CapabilityLinker resolves requested intents into an ordered dependency graph of ACTIVE skills. TargetCompiler then selects an adapter per semantic operation using backend availability, priority, cost and substrate constraints.

JIT plans are keyed by both IR fingerprint and environment fingerprint. A backend failure may raise a SkillDeoptError. The failed operation/backend assumption is persisted for that exact environment, the plan is invalidated and the operation is recompiled to the next viable backend instead of repeating the same failed fast path on every run.

## Aura integration contract

Aura must not implement its own skill-selection or compilation logic.

The canonical UI boundary is SkillRuntime.skillMachineSnapshot(), schema `jaco.skill-machine.snapshot/v1`. It exposes only presentation-safe operational state:

- active executions
- recent compile/execution/deoptimization events
- catalog counts
- JIT/deoptimization counters

The intended Aura workbench design is one existing operator surface with skill activity embedded into mission/execution context. No separate skill chat or parallel skill control plane is required.


## Adaptive Skill Optimizer

Optimization is evidence-gated rather than latency-gated.

ExecutionProfiler stores semantic execution traces separately from presentation telemetry. TraceNormalizer converts task-specific runs into comparable procedure shapes. ProceduralFamilyMiner only forms reusable families from independently verified successful runs. PartialEvaluator freezes known input/environment bindings without changing the underlying Skill ISA. TargetCompiler remains the only backend compiler; the optimizer does not introduce a second hot-path compiler.

A specialization may be promoted only after ProcessVerifier confirms equivalent semantic procedure shape plus independently verified preconditions and postconditions, and BenchmarkArena shows a strict Pareto improvement across runtime/model/vision/tool/deoptimization cost dimensions.

The legacy Continuum CapabilityCompiler remains as a compatibility facade for scheduler/revenue/self-model APIs, but its trajectory identity now uses the canonical Skill Runtime procedure normalizer instead of maintaining a separate signature implementation.
