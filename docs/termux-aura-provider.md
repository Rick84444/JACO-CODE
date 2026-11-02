# Termux startup with the operator's Aura provider

Use `jacoctl activate --provider aura --fast` (or `restart --provider aura
--fast`) after installing this change. Select and save a text-capable planner
provider/model in the IDE first. This is the existing operator planner choice,
not a new provider registry and not merely an active chat dropdown.

The `aura` routing mode persists model supervision off, disables Ollama startup,
and disables automatic llama.cpp startup. Workplace still starts SEER and Nova,
but does not discover or spawn local models. Core and Workplace default to the
same runtime directory for the existing planner-choice file; explicit paths
remain authoritative. Explicit model-supervision settings in private runtime.env
survive stale project defaults and the Workplace service launcher.

SEER performs the existing small startup inference using the saved operator
choice. A missing choice or a refused/failed inference blocks Nova; local
fallback is disabled in this explicit mode. Paid inference still requires the
existing `JACO_ALLOW_PAID_MODELS=1`, available credentials, a permitted endpoint
and Continuum reservation. Selecting `--provider aura` does not enable spending,
set a key, relax a budget or authorize a cloud fallback. No external provider
was contacted by the regression tests. An authorized cloud startup probe can
consume tokens under those pre-existing limits.

After activation, check `jacoctl status` and
`bash runtime/termux/aura-footprint.sh` from the checkout root. Acceptance on the
phone requires the selected provider to answer, Nova to reach RUNNING, no new
LiteRT/llama.cpp/Ollama process, and one real read-only tool task with a receipt.
A process health check is not a completed mission.

If `jacoctl status` reports orphan runsv processes, use the existing explicit
`jacoctl repair-supervisor` before activation. This interrupts JACO services and
leaves Core/Workplace down. Do not use broad process kills or replay uncertain
missions. Unknown owners or a failed orderly shutdown still block activation.

Shutdown fixes cover an already-exited child and a late runtime/model/SEER
probe completing after stop. They do not establish why Android previously
terminated a process or prove resistance to Android process reclamation.
SEER, Nova and Workplace remain separate processes. No mission data, ledger,
lease, stored provider credential or runtime database is migrated/deleted.

To return to a supervised on-device model, deliberately select
`jacoctl activate --provider litert --fast` or `--provider llamacpp`.
These existing local selections retain their existing cloud-disable policy.
