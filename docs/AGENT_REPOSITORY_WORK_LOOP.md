# Prioriterad arbetsloop för JACO-agenter

Status: SPEC för hela loopen; varje iteration får separat evidensstatus.
Operatörsbeslut 2026-09-23: underagenter får granska och städa repot; commit, push och merge är godkända inom uppgiften och nedanstående verifieringsgränser.

## Mål och mandat

Gör den befintliga JACO-runtime:n stabil vid uppstart, modelloberoende, återupptagbar och verifierbar. Integrera canonical ägare; bygg inga parallella agent-, Vault-, planerings- eller synksystem.

Godkännandet är inte tillstånd att radera okända arbetsfiler, publicera hemligheter, kringgå skyddsregler, använda obegränsad betald inferens, ändra ekonomiska spärrar eller avbryta andras aktiva uppdrag. En startbegäran får inte automatiskt exponera nya publika endpoints. Begär beslut om kostnad, destruktiv migration eller ny säkerhetspolicy behövs.

Detta dokument är en körinstruktion och backlog, inte en installerad bakgrundsscheduler. Ingen kontinuerlig drift eller framtida automatisk körning får påstås utan att en sådan mekanism faktiskt har konfigurerats.

## Agentroller och ägarskap

| Roll | Ansvar | Begränsning |
| --- | --- | --- |
| Samordnare/integratör | Huvudmål, aktuell backlog, Workspace, filansvar, integration, Git-leverans | Enda Git-skrivaren för iterationen |
| Uppstartsagent | Startordning, identitetskontroll, konfiguration, timeout, processägarskap | Inga produktionsstopp utan samordning |
| Runtime-agent | Provider-routing, bounded retries, durable missions, receipts | Inga modell- eller kostnadsöverstyrningar |
| Repo-agent | Genererade filer, ignore-regler, dokumentation och bevisad död kod | Inga okända filer raderas; ingen massformatering |
| Oberoende granskare | Felvägar, sekretess, testkvalitet, diff och accepteranskriterier | Granskar inte sin egen ändring som oberoende bevis |

Högst tre avgränsade underuppgifter parallellt per samordnare. Roller kan växla mellan iterationer. Alla agenter måste läsa AGENTS.md, masterkontraktet, bootstrapkontraktet och eventuella närmare instruktioner; registrera eget sanningsenligt agentkort; synka, ACK:a och publicera READY före delat arbete. Saknas Workplace: DEGRADED_UNSYNCED, inga påhittade samordningsbeslut.

## Loop: från observation till verifierad leverans

### 1. Läs verkligt tillstånd

- Identifiera checkout, remote, branch, HEAD, origin/master och faktisk remote SHA. Hämta aktuell remote-status före integration.
- Lista dirty/untracked filer. Märk dem med känd ägare eller UNKNOWN; ta inte med dem automatiskt.
- Läs Workplace DECISION, CLAIM, HANDOFF, ERROR och aktuella uppdrag. Samordningshistorik är ledtrådar, inte Git- eller runtime-bevis.
- Identifiera aktiva processer, port, produktidentitet, startkälla och uppdragsägare utan att skriva ut hemliga processargument.
- Dokumentera Current State, Target State, Gap, Constraints, Risk och Verification Plan.

### 2. Välj nästa prioriterade uppgift

Välj högsta olösta risk som kan avgränsas och verifieras. En blockerad fysisk enhet hindrar inte oberoende källkodsarbete. Flytta inte till UI-polish medan runtime correctness är olöst.

Varje arbetspaket ska innehålla: id, huvudmål, prioritet, canonical owner, filscope, ansvarig agent, beroenden, reproduktion, acceptanskriterier, testkommandon, stoppvillkor, rollback och evidenslänkar. Sätt inte godtyckliga tidslöften.

### 3. Tilldela och säkra filansvar

- Samordnaren delegerar konkret filscope och förväntad evidens.
- Agenten tar Workspace-claim. Konflikt betyder samordning, inte överskrivning.
- Förnya claim och heartbeat under arbetet. Publicera betydande fynd när de upptäcks.
- Använd PROGRESS/RESULT endast med verkligt missionId; annars FINDING/HANDOFF.

### 4. Reproducera och implementera

- Skapa regressionstest för det observerade felet där möjligt.
- Välj minsta kompletta förändring i befintlig ägare; inga alternativa motorer eller låtsasframgångar.
- Modellval kommer från explicit konfiguration/capabilities. Fallback kräver uttrycklig policy och befintlig kostnads-/privacy-gate.
- Retries har deadline, försöksbudget, backoff och cancellation. Muterande operationer får inte upprepas vid okänt utfall utan reconciliation.
- Kritisk state skrivs durabelt innan framgång rapporteras. Secret values får inte hamna i argv, logg, testfixture, rapport eller Git.

### 5. Verifiera i lager

1. Syntax, schema, lint/typecheck och relevant build.
2. Enhetstester för normalfall samt saknad konfiguration, authfel, nätfel, timeout, dubbla anrop och felaktig respons.
3. Integration genom den faktiska registreringen/importen/routen, inte en orphan-modul.
4. Isolerat runtime-test med kontrollerad state och egna portar. Testfixtures får inte oavsiktligt ärva operatörens .env.
5. Samordnad målmaskinsverifiering när ägarskap och behörighet är klarlagda.
6. Persistens och återhämtning: avbrott/restart, samma idempotency key, inga dubbla sidoeffekter, verifierbar slutreceipt.

HTTP 200 räcker aldrig ensamt. Kontrollera produktidentitet, schema, payload och förväntad postcondition. Model metadata är inte inferensbevis. En seedad Android-peer är inte en ansluten enhet. En passerad testsuite med intern live-skip är inte fullstackbevis.

### 6. Oberoende granskning

Granskaren kontrollerar scoped diff, anslutning till runtime, felvägar, permissions, race conditions, secret-risk och evidens. Kritiska/höga fynd blockerar merge. Ändrad kod efter granskning kräver ny relevant granskning och tester; gamla gröna resultat gäller inte automatiskt.

### 7. Commit, push och merge

- Samordnaren granskar exakt fillista och diff. Stage:a uttryckliga sökvägar, aldrig allt i ett delat dirty repo.
- Kontrollera hemligheter och oavsiktliga miljö-/statefiler. Dokumentera baseline, tester och kvarvarande begränsningar.
- Commit och push på avgränsad branch; skapa eller uppdatera rätt PR. Undvik duplicerade PR:er för samma patch.
- Kontrollera aktuell base/master och hantera drift utan att skriva över andras ändringar. Kör tester igen efter konfliktlösning.
- Merge är godkänd endast när obligatoriska kontroller är gröna på exakt aktuell head, granskningen är klar och merge är möjlig. Saknade kontroller räknas inte som gröna; använd aldrig admin-bypass.
- En avgränsad källkodsfix kan mergas med dokumenterat återstående drifttest, men får då inte kallas fullt driftsverifierad.
- Verifiera remote master efter merge och kopplingen till PR/commit. Rapportera MERGED separat från TARGET-HOST VERIFIED.

### 8. Uppstart och driftsättning

- Kontrollera att ingen annan agent äger pågående mutation/reload. Dokumentera aktiva Nova-missions och återhämtningsläge.
- Kör sidoeffektsfri preflight: exekverbara filer, konfiguration utan värden, portar, dependencies och rätt produktidentitet.
- En upptagen port är inte en frisk JACO-tjänst. Adoptera endast verifierad rätt tjänst med tydligt ägarskap; annars avbryt innan dubbla processer startas.
- Läs den valda installationens startkontrakt. Root npm start, Windows-stack, Continuum CLI och Android/Termux är inte utbytbara startkommandon.
- Starta bara nödvändiga komponenter i verifierad beroendeordning. Starta inte handelsloopar, publika tunnlar eller valfria tjänster implicit.
- Vid misslyckande: spara sanerad evidens, stoppa endast processer som iterationen själv startat och äger. Ingen blind kill-all eller reset.
- Kontrollera verkligt begränsat uppdrag: plan -> execution -> durable receipt -> evidens -> verifierat resultat. Behåll operator review där kontraktet kräver det.

### 9. Reflektera, lämna över och välj nästa varv

Publicera strukturerat worked, failed, unexpected, root_causes, reusable_patterns, future_improvements och knowledge_updates. Varje slutsats har provenance och verifieringsstatus; gammal evidens kan bli STALE.

Uppdatera backlog, aktuell risk, nästa ägare och reproduktionssteg. Avsluta/releasa claims. Fortsätt nästa oberoende uppgift medan mandat och kontext gäller. Vid behov av ny behörighet eller verkligt användarbeslut: rapportera blockeraren och begär endast det som saknas.

## Prioriterad backlog och acceptans

### P0 — sanningsenlig säkerhet och säkra starter

**P0.1 Native Vault-status och handshake.** Nuvarande granskning har funnit framgång/StrongBox-claims utan verifierad Android-broker. Canonical routeägare måste identifieras mot befintligt Vault. Acceptans: frånvarande broker ger unavailable/unverified, inga lyckade native import/lease-claims; verklig konfigurerad broker verifierar identitet/challenge och ger durabel evidens. Inga hemligheter i svar/logg.

**P0.2 Uppstartens sidoeffekter.** Preflight före Vault-import och processstart; bevara operatörens betald-provider-policy; förhindra tyst tapp av Vault-laddade runtime-credentials. Acceptans: saknad prerequisite eller portkonflikt startar ingenting; giltig konfiguration förblir oförändrad; inga secret values i diagnostik.

### P1 — explicit routing, processägarskap och återhämtning

**P1.1 Modellval från konfiguration.** Avlägsna oavsiktlig DeepSeek-överstyrning i governor och automatisk betald fallback. Skilj allmän provider-selection från lokal discovery. Acceptans: varje stödd provider startar utan lokal-enum-krasch; vald Ollama-failure anropar ingen annan provider om fallback inte explicit tillåtits. Ingen Gemma-ersättning för vald cloudmodell.

**P1.2 En canonical startup-ägare per driftläge.** Dokumentera Windows-stack, Continuum och Termux; förbättra identitetsvaliderad adoption samt spawn error/health deadline. Acceptans: andra startförsöket skapar inga dubletter; fel tjänst på port stoppas inte/adopteras inte; misslyckad child-start ger tydligt fel och korrekt exitstatus.

**P1.3 Nova/SEER bounded execution.** Acceptans: provider-timeout och permanent authfel leder till begränsade försök och explicit blockerad status; restart återställer mission och receipts utan dubbel mutation; UNKNOWN_OUTCOME reconcileras.

**P1.4 Verklig Android/desktop-synk.** Hämta icke-hemlig anslutningskonfiguration från Git/Workspace-ägaren. Acceptans: fysisk enhetsidentitet, autentiserad heartbeat, schema, sekvens/ACK, durabel round-trip och återanslutning efter restart. Seedad OFFLINE-post räcker inte. Kräver tillgänglig enhet; blockera bara enhetsberoende steg.

### P2 — repohygien och verifieringsbredd

**P2.1 Ignore och hemligheter.** Skydda verkliga .env-varianter men behåll explicita exempelmallar; granska diagnostik utan att skriva ut innehåll. Acceptans: negativa och positiva ignore-tester; inga riktiga nycklar eller sessiontokens i scoped Git-diff.

**P2.2 Dubblerade/överblivna filer.** Inventera tracked .bak, genererad state och alternativa startdokument. Bevisa frånvaro av imports, packnings-/buildreferenser och runtimeanvändning före borttagning. Okända eller användarägda filer lämnas kvar med ägarfråga. Git-spårad borttagning ska vara återställbar.

**P2.3 Reproducerbar CI.** Låsta beroenden, relevanta path filters, Windows/Termux-specifika kontrakt och tydliga live-skip-statusar. Acceptans: grönt på exakt PR-head och korrekt felstatus för verkligt misslyckad runtime-testning.

### P3 — kunskap och långtidsevidens

Extrahera återanvändbara felmönster efter verifierade iterationer. Bygg uthållighetstest med begränsad kostnad och explicit avbrott, minnes-/processmätning och restart recovery. UI-polish kommer efter dessa correctness-gates.

## Iterationsjournal

Varje iteration ska rapportera följande utan att likställa nivåerna:

| Fält | Innehåll |
| --- | --- |
| ID och huvudmål | Backlog-id, konkret scope och canonical owner |
| Baseline | Checkout, branch, lokal SHA, remote SHA, andra dirty filer |
| Agenter | Agent-id, ansvar, filclaims och granskare |
| Ändring | Exakt fillista och varför |
| Evidens | Kommandon/resultat, skip, CI-run, runtime-observationer |
| Git | Commit, PR, head SHA, merge/master SHA eller NOT_MERGED |
| Drift | NOT_RELOADED / IMPLEMENTED_UNVERIFIED / TARGET-HOST VERIFIED |
| Återstående | Blockerare, nästa steg, rollback och ägare |

Första pågående iterationen omfattar avgränsad uppstartshärdning och repo-hygien. Hela backloggen är inte färdig eller schemalagd bara för att detta dokument finns.
