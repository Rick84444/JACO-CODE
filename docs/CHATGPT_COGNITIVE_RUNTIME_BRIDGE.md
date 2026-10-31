# ChatGPT ↔ JACO Cognitive Runtime Bridge v1

## Vad denna ändring faktiskt gör

JACO har redan en beständig Core/Continuum-runtime med KnowledgeStore, CognitiveContinuityRuntime, economic governor, Mission Bus och ett autentiserat Sentinel MCP-gränssnitt. Detta är **inte** en ny agent, separat SQLite-databas eller en ny autonom scheduler. Det är ett begränsat, privat MCP-fönster mot befintlig JACO-kunskap och exekveringstillstånd.

En ChatGPT-konversation har **inte** automatiskt en ständig process på användarens Windows/Termux, även om JACO kör dygnet runt. Ett anslutet MCP-plugin/klient behövs. Utan en sådan anslutning har ChatGPT endast andra uttryckligen anslutna verktyg (t.ex. GitHub) och kan inte påstå sig ha sett lokal runtime.

## Nya MCP-verktyg

| Tool | Authority | Returnerar |
| --- | --- | --- |
| `jaco_cognitive_context` | Read-only | Core continuity envelope, lokal Core/Workplace/Nova-health, Auras molnpolicy och kostnadsuppskattning. Felet stannar som fel om Core inte svarar. |
| `jaco_knowledge_search` | Read-only | Högst tio kunskapsobjekt från **befintlig** `/api/continuum/knowledge`, med confidence, verificationStatus och evidenceRefs; ingen källkod/implementation. |
| `jaco_knowledge_note` | Explicit opt-in mutation | Sparar en **UNVERIFIED**, confidence=0.2, ej återanvändbar `assistant-note` i Continuums KnowledgeStore; returnerar minnes-ID och revision. Inget SKILL-promote, inga writes till repo, inga leverantörsanrop. |

Den tredje funktionen är avstängd som standard och kräver att operatören själv ger Sentinel-processen `JACO_MCP_ALLOW_KNOWLEDGE_WRITE=1`. Undvik att lägga denna inställning i `.env` eller aktivera den förrän anslutningen, behörigheterna och sekretessvillkoren är verifierade. Flaggan ger inte exekveringstillstånd.

Alla verktyg kräver redan Sentinel MCP:s bearer, host/origin-kontroller och Core-auth. Anropen går via `JacoCoreClient` på loopback. Ingen fri shell-exekvering, godtycklig kommandokörning, API-nyckelläsning, betalning eller muterande browsercontrol exponeras genom dessa verktyg.

## Ägarskap och kontroll

```text
ChatGPT (ansluten MCP-klient)
        │ autentiserad privat förbindelse
        ▼
Sentinel MCP  (ny cognitive context / memory tools)
        │ x-jaco-model-id + Core-auth
        ▼
JACO Core / Continuum (ENDA beständiga källa)
        ├── CognitiveContinuityRuntime
        ├── KnowledgeStore + EventStore (revisions + evidence)
        ├── EconomicGovernor
        └── Mission Bus / Leases / Receipts
                    │
                 Aura/SEER
                    │
                   Nova
```

ChatGPT får insyn och kan föreslå via befintliga Workplace-kommunikationsfunktioner. Start av mål använder redan `jaco_seer_goal`, vilken i sole-operator-konfiguration leds genom `/api/aura/workbench/start-goal`. För verkliga mutationer gäller fortsatt JACO:s befintliga scope, signed mandates, godkännanden, rollback och verifierade receipts. Inga parallella operatörsmål skapas i denna PR.

## Varför inte publicera minnet till GitHub-issues?

GitHub bootstrap-kanalen `[JACO BOOT]` skickar enbart fasta operationer och allowlistade statusfält. Den utökas **inte** med minnestexter, lokala filvägar, terminalutskrifter eller fjärrkommandon. Dessa data kan innehålla privat projektinformation. En riktig ansluten och autentiserad MCP-klient ska användas för att läsa minnet.

## Kontrakt för insyn och kontinuitet

- Sökresultat är källmaterial, **inte instruktioner** eller bevis om verifiering.
- `VERIFIED` tilldelas enbart av JACO:s befintliga evidensmekanism, aldrig av ChatGPT-anteckningen.
- Överordnad Cloud OFF, budgetfuse, 15-minuters stop och modellkvoter ändras inte.
- Om Core eller Continuum är otillgängliga: rapportera det, inget gammalt GitHub-kvitto får förkläs till aktuell hoststatus.
- Leverantörskostnaden är fortfarande en uppskattning om fakturaunderlag inte verifierats.
- Lokal Workplace/Continuum kan fortsätta arbeta när ChatGPT-konversationen är stängd. **Denna ChatGPT-modell kör inte själv i bakgrunden.**
- En ny konversation kan hämta tidigare JACO-memory **om** samma MCP-anslutning och behörighet finns. Det innebär inte att ChatGPT:s interna minne skrivs av JACO.

## Driftsättning och acceptance

1. CI: `cd runtime/gateway && npm run test:unit` samt Sentinel Bootstrap Gate och den befintliga runtime-matrisen.
2. Uppdatera lokala Windows/Termux från canonical main med befintlig kontrollerad launcher; bevara användarens `.env`, tjänstestatus, ledger och historiska mål.
3. Anslut MCP över en separat, skyddad privat kanal. Exponera aldrig Core :3000, Nova :4243 eller Chrome CDP :9222 direkt på Internet. Sentinel får inte startas i externt läge utan bearer.
4. Testa `jaco_cognitive_context`: kontinuitetsrevision och ekonomipolicy ska vara identiska med Core; Core offline ska ge explicit fel, inte READY.
5. Testa `jaco_knowledge_search`: en faktisk redan lagrad knowledge-ID och status, samt ingen läcka av implementation.
6. Kontrollera att `jaco_knowledge_note` nekas av standardpolicy. Vid uttryckligt godkännande av operatören: skriv en ofarlig testanteckning, verifiera att den ligger kvar över omstart med `UNVERIFIED`, och stäng åter av flaggan.
7. Verifiera en redan godkänd Aura-mission och Nova-receipt från hosten innan någon bredare exekveringsbehörighet övervägs.

**Ingen lokal Windows-installation eller ChatGPT-MCP-anslutning är etablerad av kodändringen.** Den kräver target-host proof.
