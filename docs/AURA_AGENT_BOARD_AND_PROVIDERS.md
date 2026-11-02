# Aura: Agent board and provider choice

The agent board is a read-only view of Workplace and Durable Nova. Reported DONE, agent contact and verified tool steps are separate observations; none of them replaces the main goal's acceptance evidence. The view uses Aura's existing refresh loop and makes no model calls. Creation and review use the existing SEER and approval paths.

## Switching the model for manual chat

1. Choose a registered provider in **Aura provider**.
2. Type the model name in **Aura model**. Suggestions are not a locked list.
3. The choice is saved in this browser's localStorage. **Default** returns to the server's default. **Refresh provider list** fetches new registrations; **Manage providers** opens the existing provider management.

The backend sends an explicit choice through the existing ProviderRegistry. A missing provider, credential or pricing fails before dispatch; an explicit provider is not switched automatically. The SEER option uses the existing SEER routing. The choice applies to manual Aura chat and does not change Nova's autonomous model configuration.

Cloud models require conservative pricing information. The existing Ollama configuration is reused. Other models use `JACO_AURA_PROVIDER_PRICES_JSON`, keyed by `provider-id/model-name` with positive `input`/`output` in USD per million tokens. Configure real current prices, not invented examples. At most 1 USD per day including reservations is enforced through the existing EconomicGovernor. Missing usage or a transport error after dispatch leaves the reservation as an unknown outcome.

Loopback endpoints are treated as local, except known/priced cloud models and model names with `-cloud` or `:cloud`. A local proxy for other paid models must therefore have explicit pricing. The budget is a local call gate, not a guarantee about the provider's billing or subscription fees. The model field does not install models or create provider accounts.

## The delivery's verification boundary

Verification reports must distinguish source code, built artifacts, an isolated runtime and an installed runtime. A browser check with a copy of real persistent missions proves display of that copy; it does not prove that those missions were executed during the check. An installed server needs to load the new backend and frontend version before the features apply there.
