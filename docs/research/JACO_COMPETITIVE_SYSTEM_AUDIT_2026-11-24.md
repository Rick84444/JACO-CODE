# JACO Cognitive IDE — konkurrensgranskning och verifierbar gap-analys
**Datum:** 2026-11-24  
**Referens:** Användarbedömning JACO 5,4/10, Codex och VS Code cirka 8/10. Dessa är subjektiva utgångsvärden, inte uppmätta resultat.  
**Ändamål:** Bedöma kända arkitekturkontrakt och produktflöden före implementation, inte påstå att JACO eller konkurrenterna har benchmarkats.

## Käll- och evidensnivå
- **S1:** Dokumenterad officiell funktion eller granskbar öppen källkod.
- **S2:** Granskad JACO-kod på `main` (2026-11-24). Öppna PR:er kan innehålla ännu inte mergad funktion.
- **U:** Ej verifierad i verklig körning; måste prövas på en faktisk Windows-installation och Android PWA.
- Konkurrenternas proprietära interna implementation (Cursor, delar av VS Code/Copilot, Claude Code, Devin) är inte fullständigt åtkomlig. Dokumenterade funktioner får inte likställas med uppmätt kvalitet.

## Konkurrentarkitektur – observerad funktion och relevant lärdom

| Referens | Källbelagd styrka | Implikation för JACO |
| --- | --- | --- |
| Codex (öppen kärna) | App-server med agentloop, central tjänsteägare för MCP, verktyg, sandboxpolicy, approvals, threads, state och budget. `SessionServices` har separata ansvar och agentens session/rollout kan kopplas till frontend. | En **kanonisk Aura Core** med händelseflöde och beständigt uppdrag; verktygspolicy ska inte dupliceras i GUI, chat och gateway. |
| VS Code / Copilot | Separat redigerings- och agentvy, verktygsutökning via extensions och MCP, ändringsgranskning, Git, editor-kontext, debugging. MCP serverhantering med start/stopp, auth, trust, konfig och felsökning. | GUI måste bära hela **plan–edit–test–review–commit** utan terminal- eller kontextförlust. |
| Claude Code | Regler, skills, hooks och isolerade subagentkontexter; färre irrelevant mellanresultat i huvudtråden. | Aura äger uppdraget men kan delega *begränsade* specialistjobb med separata kontexter och ärvda rättigheter. |
| Cursor | Kodbasindex, automatiska kodändringar, terminal/browser-verifiering, checkpoints samt projektsamordnare. | Context selection + återställbara ändringspunkter måste vara förstklassiga funktioner. |
| OpenHands SDK | Delar agentcore, tools, workspace/sandbox och agentserver; en muterbar konversationsstatus för replay. | Håll execution state och UI-projektion skilda; replay får aldrig återupprepa okänt genomförda sidoeffekter. |
| Cline | Taskhistorik, checkpoint, tokenkostnad/varaktighet och MCP-marknadsplats. | Instrumentera uppdrag och gör installation/anslutning begriplig utan manuella configfiler. |
| Devin Desktop (tidigare Windsurf) | Devin Local ersatte Cascade under 2026; agent-first desktop, lokala/cloud arbetsytor. | Jämför mot **Devin Desktop**, inte utgångna Cascade som om den vore aktuell. |
| Roo Code | Produkterna avslutades 2026-05-15; historiskt intressant, men inte aktiv benchmarkreferens. | Lär av gammalt open source-arv via Cline, prioritera inte Roo som aktiv produkt. |

### Källor
- https://developers.openai.com/blog/codex-as-a-platform
- https://github.com/openai/codex/blob/main/codex-rs/core/src/state/service.rs
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- https://code.visualstudio.com/docs/agents/run/agents-window
- https://code.visualstudio.com/docs/agents/run/manage-mcp-servers
- https://code.visualstudio.com/docs/agents/run/review-code-edits
- https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more
- https://cursor.com/docs/agent/overview
- https://github.com/OpenHands/docs/blob/main/sdk/arch/design.mdx
- https://docs.cline.bot/core-workflows/task-management
- https://github.com/RooCodeInc/Roo-Code-Docs/blob/main/docs/sunset.md
- https://docs.devin.ai/desktop/changelog

## JACO: verifierad kod och begränsningar

| Yta | Befintligt i `main` (S2) | Konsekvent gap/U |
| --- | --- | --- |
| MCP HTTP | `runtime/src/server/mcp/httpMcpClient.mjs` skickar `initialize`, `notifications/initialized`, `Mcp-Session-Id`; stöder `tools/list` + `tools/call`; förhandlar `2025-03-26`/`2025-06-18`. | **P0:** uppgradera versioneringsadapter för 2026-07-28. `server/discover`, stateless `_meta`, `Mcp-Method`/ `Mcp-Name`, cache/TTL och MRTR där relevanta. Äldre servrar måste fortsätta fungera. |
| MCP GUI | `runtime/src/components/McpServersPanel.tsx` kan lägga till stdio/https, starta, lista verktyg, ställa access och visa några anrop. | **P0:** OAuth-sign-in, resurs-/promptbläddrare, katalog med faktiskt anslutningsstatus, konfig-källa/trust, diff/återställning, livscykel, precis diagnos. `#381` är *inte* på main vid denna granskning. |
| IDE editor | `runtime/src/components/AuraCodeEditor.tsx`: Monaco med dirty buffer och expectedHash för optimistisk låsning. | **P0:** riktig språkserver (LSP), diagnostik, fil- och symbolnavigering, multi-diff, breakpoint/debug och koncept för delad editor/agent snapshot. |
| Terminal | `runtime/src/components/ReceiptTerminal.tsx`: xterm som är avsiktligt **read-only kvittovyn**, ingen PTY. | **P0:** separat autentiserad interaktiv terminal med verklig processägare/sandlåda; bevara kvittoterminalen för förståelig aktivitetslogg. |
| Semantisk repo | `runtime/src/server/continuum/semanticRepositoryModel.mjs`: TypeScript-AST för JS/TS, importgraf, symbols, regex fallback och evidenskvitton. | **P1:** uppdateringsbara index, LSP-koppling, relevansrankning, tvärspråklig analys, verifierbara tester/lärdomar, repository version-koppling. Inte 'ingen repository intelligence'. |
| Kontinuitet | `runtime/src/server/continuum/cognitiveContinuityRuntime.mjs` persistenta projektioner/checkpoints via Continuum. | **P1:** kraschtåligt återupptagande med semantik för okända sidoeffekter, rehydrering av föräldra-/specialistuppdrag; fysisk återstartstest. |
| Cloud Aura Control | `runtime/src/server/connected/jacoLinkHost.mjs` utgående WebSocket, parning/revoke, strikt `site/jacocode.com/link-protocol.mjs` allowlist. PWA `site/jacocode.com/public/link/remote.js` med chatt/plan/minne/beslut. | **P0:** verifierad källa och driftstatus, mission event stream, anslutning efter uppkopplingsbortfall, kvittohämtning, identitets- och revisionsbindning, inkrementellt Render-relä. `#382` är utkast, inte driftsatt. |
| Beslutsmandat | `agents/lib/standing-tool-authority.mjs`, signerad stående mandatadapter; GUI task toggles. | **P0:** enda exekveringsauktoriteten genom alla tool adapters; konfigdrift, underagent-arv, revocation och lokala kostnadstak. Många policytester är gröna; det bevisar inte live-OS-isolering. |

## Kritisk MCP-versionering
Enligt officiell specifikation 2026-07-28 används inte längre sessionshandshake `initialize`/`initialized` och `Mcp-Session-Id`. HTTP-anrop bär protokollversion och klientmetadata, server discovery är valfri, och `Mcp-Method`/`Mcp-Name` används för routing. MRTR hanterar fortsättningar/elicitation, och listor kan cachas med TTL. JACO-klienten behöver en versionsstyrd transportmodul och konformanstester, **inte** en global string-replace.

Officiell källa: https://blog.modelcontextprotocol.io/posts/2026-07-28/

## Prioritet och accepterade leveranser

### P0 — Instrument och exekvering
1. **MCP transport/authorization:** testserver för gammal och ny version, OAuth PKCE/callback, client metadata, status `CONFIGURED/AUTH_REQUIRED/AUTHENTICATED/TOOLS_DISCOVERED/EXECUTION_VERIFIED`; aldrig lagra bearer i GUI eller skriva dem till logg. Acceptans: två verkliga providers, en public read och en OAuth, med omstart, expired credentials, 401, stale session, revoke; nekat verktyg får inte gå via annan adapter.
2. **GUI full task-loop:** med eget repo öppet ska operatör och Aura kunna läsa symboler, ändra dirty buffer utan att tappa innehåll, få diagnostics, köra ett test, granska file diff, behålla/ångra per fil och göra Git-commit. Acceptans: inga osparade ändringar skrivs över av agenten, full trace till sourceCommit.
3. **Execution terminal:** verklig PTY med behörighetsgate; xterm receipt-vyn förblir read-only. Acceptans: kör lång process, visa stdout/stderr/exit, avbryt, återanslut och verifiera ingen dubbel exekvering; Windows E2E krävs.
4. **Cloud Aura Control:** *en* lokalt körande Aura; Render kundrelä och privat Cloudflare kontroll hålls isär. Acceptans: parning, telefonkoppling, start, steering, kvitto, offline/reconnect, revoke och versionsbevis på fysisk Windows+Android; inga offentliga oskyddade tunnlar.

### P1 — Kärnan blir effektivare än alternativen
5. **Context Broker:** uppdelning mellan editor-dirty-buffer, commit/index, aktuell arbetsuppgift, MCP catalog och historiskt evidens. Rankat och tokenbudgeterat, inte dump av alla verktyg i prompt.
6. **Specialister:** en Aura som kan ge deluppdrag till verktygsbegränsade arbetare med egna kontextfönster, explicit budget och samtidighetstak; inget parallellt policycenter.
7. **Hypothesis/Test/Evidence:** 2–5 kandidatstrategier på komplex uppgift, mät faktisk tid/fel/kostnad, spara både vinnare och falsifieringar som Knowledge Object; testbenches och acceptance receipts.

### P2 — Enterprise-kvalitet
8. Identitet/RBAC/scopes för kopplingar, per-tenant isolering, revocation, loggredigering och granskningsbara revisions-ID:n.
9. Installations-, uppgraderings- och rollback-UX på Windows; mobil endast PWA som standard.

## Jämförande benchmark – föreslaget protokoll, **inte utfört**
Kör **samma frysta repo och specifikation** på Codex, VS Code/Copilot, Claude Code, Cursor, OpenHands, Cline och JACO. Välj minst:
- Bugfix med sex filers beroendekedja och förutbestämda regressionstester.
- Ny vertikal funktion (GUI+API+tester).
- 401/OAuth-felsökning med simulerat expired token och scope reduction.
- Repo-index och refactoring med dirty editor buffer.
- Återställningsscenario efter processcrash mitt i mutation.
- Användarstyrd fjärrmission med nätverksavbrott, Android och revoke.
- Autonom 60-minuterskörning med kontrollerad kostnad och föränderlig testmiljö.

Mät per uppgift: korrekthet (held-out tests), regressionsandel, arbetstid, prompt- och verktygstokens, faktisk kostnad, antal verktygsförsök, antal mänskliga avbrott, rapporter om ogrundad framgång, återhämtning efter fel och kvalitet på inspektionsbar diff. Minst tre oberoende försök/system/modell där möjligt. Rapportera median och spridning. **Inga konkurrensbetyg eller hävdad prestandavinst innan mätning.**

## Integrationsordning i aktuell GitHub
1. Verifiera/merge konfliktupplöst MCP-gren `#381` efter hela exakta CI-HEAD, granska protokoll/credentials/transport. Stäng sedan ersatt `#380` och `#361`, inte före.
2. Verifiera `#382` (Cloud PWA provenance/reconnect), därefter semantiskt granska `#355` och `#357` mot dagens main. Skilj privat Cloudflare från senare kund-Render, ingen dubbel Aura.
3. Separat PR för **MCP 2026-07-28 konformans och OAuth** med sanningsenlig integrationsstatus.
4. Separat PR för editor–LSP–diff–terminal med faktisk fysisk Windows-provkörning.
5. Följ med en hållbar benchmark-körning och dokumenterade receipts.

## Negativa kontrollfall (måste passera)
- OAuth-token från konto A aldrig till konto B, och aldrig i logg, URL eller modellprompt.
- MCP-server som byter tool-schema får inte använda gammal implicit allowlist.
- Disabled GUI tool/skill förblir disabled efter korrumperad fil, omstart och annat transportval.
- En PR med gröna Linux-tester, men utan Windows-E2E, får inte märkas 'fysiskt verifierad'.
- Uppkopplingsbortfall efter muterande anrop får `OUTCOME_UNKNOWN`, inte blind replay.
- Dirty editor-buffert får aldrig skrivas över av disk- eller fjärrpatch utan konfliktbeslut.
- Frånkopplad/revoked fjärrenhet får inga nya RPC-anrop.
- En lokal 2B/4B modell får inte uppfattas som framgångsrik enbart därför att ett verktyg returnerade en HTTP 200; slutresultatet kräver hållna tester.

**Slutsats:** JACO har påbörjade komponenter i nästan alla områden; den största avståndet till referenssystemen är integrerad arbetsflödesduglighet, modern MCP, verklig sandbox och verifierad fjärrdrift. Detta dokument är forskningsunderlag, inte implementation eller benchmarkresultat.
