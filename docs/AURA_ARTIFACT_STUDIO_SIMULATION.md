# Aura Artifact Studio — simulationsprotokoll och byggplan

Datum: 2026-10-21. Status: **DESIGN + ISOLERAD PROTOTYPSIMULERING, EJ IMPLEMENTERAT I JACO**.
Ärende: #6. Detta dokument ger underagenters **arbetskontrakt**. Det påstår inte att fristående AI-agenter arbetar i bakgrunden.


## KORRIGERAD HUVUDDESIGN — 2026-10-21, förankrad i faktisk JACO-skärmbild

**Det tidigare flik-/kortbaserade Scratchpad-konceptet är avvisat av operatören.** Prototypens fungerande säkerhetsidé (immutable source + sandboxed workcopy) behålls, men dess interaktions- och layoutmodell får INTE implementeras.

### Screenshot-grounded baseline

Skärmbilden på operatörens dator visar en stor JACO/Aura-chatt till vänster och en smalare högeryta märkt "Bakgrundsarbete". Där rullar många nära identiska händelser med statusmarkeringar, inklusive upprepade läsningar av samma fil och formuleringar om publicering. Användaren behöver själv tolka loggen. Bilden är visuell observation, inte påstående om att själva uppdragsmotorn inte fungerar. Den inskickade bildens frontend-build/commit är inte verifierad, så koppla inte blint skärmbilden till en viss React-komponent utan runtime-kontroll.

### Ny invariant: En enda Aura Stage, inga användarstyrda verktygsflikar

- **Vänster:** alltid Aura-konversation med kompakt mål-/beslutsyta. Förblir monterad; ingen separat "chat 2".
- **Höger:** **en sammanhängande, maximal arbetsyta**, kallad `Aura Stage` internt. Ingen synlig flikrad för "CDP / Scratchpad / Agent / Terminal / Preview / Evidence". Dessa är presentationsformer i SAMMA canvas, som Aura väljer kontextuellt.
- **Material först:** om Aura fångar bild, DOM/HTML eller fil, visas det som ett **stort faktiskt material** med källindikator, inte en liten bifogad fil i ett sidofält eller ett antal kort.
- **Skapande:** när en HTML-kopia genereras sker redigering i samma stage, med direkt visuell respons. Bara användaren kan ge tillstånd att skriva till ett ägt projekt eller publicera något; extern källa förblir immutable.
- **Bakgrundskörning:** komprimera repetitionshändelser till en progress-sammanfattning, t.ex. "12 läsningar – 1 fil – senaste verifierade steg". Om inget nytt resultat finns, förbli ärlig: "Arbetar – inget nytt verifierat resultat". Visa rålogg via en diskret inspektera-/historikåtgärd på begäran, **inte en permanent loggvägg**.
- **CDP:** browser capture och skärmbild visas i stage. En liten overlay när användaren inspekterar DOM, klickar ett faktiskt observerat element eller öppnar konsollogg; inte ett extra tekniskt kontrollrum med sidofält.
- **Agenter:** visa aktuell uppgiftsfördelning som en läsbar, kontextuell visuell overlay med verifierade agenter/missioner när det finns reella handoffs. Aldrig en permanent dekorativ nätverksgraf.
- **Telefoni:** stage visar en tydlig samtalskontroll med korrekt providerstatus och explicit nummer-/kostnadsbeslut när Aura håller ett utgående samtal. Ingen uppringning utifrån enbart generativt textförslag.
- **Operatörens kontroll:** endast diskreta `fäst material`, `visa historik`, `återgå till senaste`, `jämför original`, `föreslå ändring` som kontextuella affordances; inga navigationsflikar eller konfigurationspaneler i arbetsytan.
- **Manuell pin:** om användaren fäster ett material får automatiska event INTE byta ut det. Nya fynd indikeras subtilt i chatten och kan öppnas när användaren väljer.
- **Responsive:** stationär tvådelad layout (chatt ~45%, stage ~55%) med flexibla proportioner och möjlighet att dra gränsen. På telefonen visar man chatt eller stage med ett enda diskret fokusskifte, utan att skapa två olika funktioner.

### Visuell och arkitektonisk acceptance gate

1. En ny fångad skärmbild syns som **stor riktig skärmbild** i befintlig högeryta; ingen tab-switch för användaren.
2. En HTML-fångst blir en källtrogen readonly-preview, medan en separat **kopia** kan modifieras med liveförhandsvisning; inga script/nätverksanrop från opålitlig HTML.
3. När en agent testar en ändring byter stage till det mest relevanta faktiska resultatet — inte 200 duplicerade terminalrader.
4. Vid 30 identiska progresshändelser ser användaren **högst en sammanslagen rad plus räknare**, inte 30 poster, och färdigräknare baseras endast på verifierade kvitton.
5. Efter navigering/omstart finns aktiva pins, käll-id och redan sparade utkast kvar. Chattkontext bevaras.
6. Om Aura saknar ett faktiskt resultat visas `INGET MATERIAL ÄNNU` eller senaste kända källa med tidsstämpel; aldrig fejkad skärmbild, simulerad progress eller "slutfört" utan belägg.
7. Screenshot-vald sida motsvarar faktisk pin target och screenshot, annars visas mismatch tydligt.
8. Den redan befintliga `CognitiveWorkspace`, `JacoAuraComputeIDE`, Evidence, MCP och missionsmotor återanvänds. Framtagna `CdpStudio`-dataadaptrar kan eventuellt återanvändas, men PR #7:s synliga flikar/sidofält är INTE slutlig design.

### Operatörens exempel

*Operatör:* "Aura, hämta sidan och gör den modernare."  
*Aura (vänster):* "Jag hämtade sidan och skapade en redigerbar arbetskopia."  
*Högerytan:* helhetsförhandsvisning av faktiska sidan. När nytt HTML/CSS-utkast genereras transformeras samma innehåll visuellt till arbetskopians aktuella version. Diskret möjlighet `Visa original` och `Granska ändringar`. Råa CDP- och filåtgärder går att inspektera vid behov, men tar inte över huvudytan.

**Mät kvalitet med ett användartest:** efter 5 sekunders tittande ska operatören förstå *vad Aura visar*, *var materialet kommer från*, *om det går att ändra*, och *vad som händer närmast*. Om personen måste leta i flikar eller läsa rå JSON är designen underkänd.


## Vision

Auras högra yta ska vara ett **levande arbetsbord** där användaren kan få se, redigera och vidareutveckla vad Aura faktiskt har hittat. En hämtad HTML-sida blir en oföränderlig källa och en separat redigerbar kopia; en skärmbild blir en bild med ankare/annotationer, aldrig en fabricerad DOM; ett dokument blir källmaterial med proveniens; agentkörningar blir tidsstämplade observerade händelser och kvitton. Samma arbetsyta återanvänds även för CDP, git-diff, tester och telefonikontroller.

Exempel: "Aura, undersök webbsidan och bygg om den här designen." Agenten öppnar CDP på tillåtet sätt, läser källmaterial och skärmbild, sparar `artifactId`, ger användaren en immutable originalvy och en egen HTML/CSS-revision. Redigering ändrar omedelbart **endast en isolerad lokal förhandsvisning**. För att ändra ett lokalt projekt föreslås därefter en separat diff mot faktiskt ägda filer; kodkontrakt, tester och kvitton måste passera innan en ändring levereras. En extern webbplats skrivs aldrig över.

## Observerad repository-yta

- `runtime/src/components/CognitiveWorkspace.tsx`: ett redan existerande högerside-canvas; lägg till en vy, inte ett nytt IDE.
- `runtime/src/components/JacoAuraComputeIDE.tsx`: befintlig dialog, Monaco-utkast och git-diff.
- `runtime/src/components/CognitivePreview.tsx`: tar HTML från lokal projektfil och visar i `iframe sandbox="allow-scripts"` med `script-src 'unsafe-inline'`. **Får inte återanvändas oförändrad för extern infångad HTML**.
- `runtime/src/server/connected/workspaceAttachments.mjs`: bestående innehåll med hash och filgränser; kan användas för oförändrade binära original inom befintliga kvoter, men är ingen färdig visuell versionsdatabas.
- `runtime/src/server/connected/cognitiveLiveStream.mjs`, `runtime/src/server/connected/auraAgentBoard.mjs`: observerade körhändelser och agentrelationer. Återanvänd mission-/action-id.
- `agents/cdp-bridge.mjs` och `agents/nova-bridge.mjs`: riktiga mål, sidobservation och skärmbild. Skilj observerad/pinnad flik från visuellt vald flik.
- `agents/lib/bland.mjs`: telefoni med operatörsbekräftelse och kostnadsgräns; ingen automatisk utgående kontakt från scratchpad.

## Isolerade arkitektur-forks — jämförda i tankeexperiment

| Variant | Modell | Hypotetiskt uppfyllda 8 designkrav | Beslut |
|---|---|---:|---|
| A: Read-only Gallery | Bevarade hämtningar, bilder, text, spår | 5/8 | Avvisas som för passiv |
| B: Direct DOM Override | Redigera riktiga CDP-fliken direkt | 3/8 | Avvisas: fjärrmutation och opålitlig persistens |
| C: Provenance-first Workcopy | Originalhash, separata utkast, sandbox, kontrollerad projektpatch | 8/8 **i målarkitekturen** | Vald för fortsatt utveckling |

Siffrorna ovan är **designkrav mot tänkt arkitektur**, inte godkända implementationstester eller prestationer från verkliga, separat körande agenter. Inga privata GitHub-repon eller fjärrforks behövs för ett första A/B/C-experiment; temporära isolerade worktrees ska användas när kodfasen inleds, och kastas efter jämförelse.

## Utförd separat prototypsimulering (Chromium / Playwright)

En självständig, icke-integrerad HTML-prototyp kördes i Chromium via Playwright Python. **15/16 funktionella webbläsarkontroller passerade**: källkopian visades, HTML-ändringar syntes i realtid, originalsträngen ändrades inte, revision räknades upp, bild-/agent-kort visades, manuell vy-låsning fungerade, infogade skript kördes inte i värd eller iframe, arbetskopian kunde exporteras, mobil-layout visades.

**1/16 säkerhetskontroller underkänd:** fientligt HTML med externa bild-/CSS-resurser utlöste request-händelser mot en testdomän; vi har inte bevis för att nätverksanrop genomfördes. En konservativ säkerhetsgrind betraktar ändå varje begärt externt resursanrop som oacceptabelt. CSP + sandbox är **inte ensamt ett tillräckligt verifierat importskydd**. Inför reviderad import-/URL-policy och testa verklig isolering igen.

**Fem uttryckliga, ännu ej implementerade produktkrav:** utkast överlever inte sidomladdning; inget beständigt artifact-index/hash-/revisionslager; ingen verklig JACO-mission eller capture-API är ansluten; bildannotationer sparas inte; ingen verifierad koppling mellan infångad HTML och ägda projektfiler.

Dessa fem är *avsiktliga brister* i prototypen och får inte räknas som gröna tester. Prototypen är ett beslutsunderlag, **inte en mergebar produktimplementation**.

## Underagentuppdrag (simulerad avdelningsindelning, riktiga kodjobb först efter designgrind)

| Roll/arbetsström | Isolerat kodspår | Uppdrag | Falsifierare |
|---|---|---|---|
| Experience / UX | Figma-liknande handoff, `CognitiveWorkspace` | Artifact board, källa/kopia-diff, bildannotering, högerpanel med pin/follow; mobilvänlig | Användaren tappar ett utkast vid vybyte eller agent navigerar bort från pinnad vy |
| Capture / Browser | CDP-/web-fetch-adapter | Fånga HTML, screenshot, URL, tid, MIME, hash, exakt browser target-ID och mission/action-ID | Fel flik fångas, URL/proveniens är fel eller ett fientligt svar orsakar obehörig nätverksläsning |
| Artifact / Persistence | Befintliga attachments/missionstore | Immutable source artifact + copy-on-write draft revisions, CAS/fleranvändarkonflikt, återstart | Original ändras eller redigering försvinner efter kill/restart |
| Security / Red Team | Isolerad preview och transportpolicy | CSP, sandbox utan script/same-origin, parser och sanitiser, URL-/CSS-/SVG-filter, SSRF/fetch policy | Extern HTML exfiltrerar, exekverar skript, ringer API:er eller navigerar värdfönstret |
| Verification / Integration | E2E-tester och observerat uppdrag | Härleda transienta UI-spår från verklig JACO-evidens; granska att diff och tester matchar senaste revision | Texten säger DONE trots saknade kvitton, eller code patch saknar källkoppling |

Underagents ska förslagsvis köras med samma modell och isolerade arbetsgrenar/worktrees, men detta dokument skapar inte sådana aktiva processer. En integrerare äger commit/merge; tester väger tyngre än rollernas kritik.

## Data och kontrakt

`ArtifactRecord` **föreslagen schema**: `{ schema:'jaco.aura.artifact/v1', artifactId, missionId, actionId, kind:'html'|'image'|'text'|'trace', source:{uri,targetId,capturedAt,mime,sha256}, immutableBlobRef, visibility, captureReceiptRef, revisionHead }`.

`ArtifactRevision` **föreslagen schema**: `{ artifactId, revisionId, parentRevisionId, basedOnSha256, author:'operator'|'aura', kind:'html-css'|'image-annotations'|'notes', patchOrBlobRef, createdAt, verification }.`

Avskilj tre operationer:
1. `CAPTURE`: källmaterial infångat av befintligt behörigt verktyg och sparat som immutable artifact, inte en uppgift i agentens fria text.
2. `DRAFT`: operatör eller Aura skapar en isolerad revision och visuell preview; original står kvar, ref/id behålls och diff kan inspekteras.
3. `APPLY`: **separat** explicit riktat projektpatch-uppdrag mot ägda filer med coding contract, verifiering och evidenskvitto. Att dra in en extern webbplats skapar inte behörighet att publicera, handla, ringa eller ändra den.

Återanvänd JACO:s existerande event-/mission- och attachment-faciliteter; bygg inte ett nytt globalt agentlager, en andra EvidenceLedger eller parallell auth.

## Import/isolering: icke-förhandlingsbara invariants

- Infångat remote HTML betraktas som angriparkontrollerad data. Sanitera DOM/attribut/URL:er/CSS med granskad parser, inte regex. Ta bort script/event-handlers, formulär, `javascript:`, osäkra `data:`, automatiska nav, externa subresurser och farliga embeds. Bilder hämtas genom en auktoriserad separat mediaimport och görs om till lokala godkända blobar.
- Rendera importerad HTML i separat sandboxad iframe **utan `allow-scripts` och utan `allow-same-origin`**, och med strikt response-level CSP. Tillåt endast noggrant angiven styling och lokalt godkända mediaresurser. Tillåt ingen fetch, navigation, forms eller popup.
- Kontrollerna `script-src 'none'`, `connect-src 'none'`, `default-src 'none'`, `form-action 'none'`, `base-uri 'none'` är ytterligare försvar, **inte** ensam garanti. Testa nätverksförsök och inte bara lyckade svar.
- Capture/web-fetch-URL:er och redirects ska bekräftas mot nätverkspolicy (inklusive DNS och interna/private IP), utöver CDP-sessionens egna capabilities.
- Ingen skärmbild eller rå personlig webbsida i allmänna eventloggar; eventloggar innehåller referenser och krypterad/åtkomststyrd datahantering.
- Skilj *”redigerad kopia”* från *”aktiv sida på internet”*, och *”simulerad agentaktivitet”* från verklig körning.

## Genomförandeplan efter simulation — kvalitetsgrindar

**Gate 0: säker design och falsifiering.** Samla kritik från alla fem roller; portera 1 underkänt säkerhetstest och fem produktgap till reproducerbara automatiska tester. Definiera schema, saniteringsbibliotek, quota och retention, ingen dold feature rollout.

**Gate 1: artifact model + persistens.** Läs HTML/text/bild från befintliga authorized sources, spara originalref+hash, reproducerbara copy-on-write revisioner, optimistic locking, kill/restart test.

**Gate 2: visuellt scratchpad.** Lägg bara till `artifact-studio` som nytt canvasläge och stöd i Auras befintliga högerpanel; ändringsindikator, source/workcopy sida vid sida, kodredigering, liveuppdaterad iframe med uppmätt säkerhet, annotationer ovanpå bild. Tillåt mänsklig pin/follow.

**Gate 3: CDP och agentkontroll.** Koppla Browser CDP-snapshots och Durable Nova actions till artifactref; klick på event öppnar exakt rätt material, utan att CDP-polling automatiskt byter session eller utför åtgärd. Befintlig PR #7 är grund för CDP-vyn, inte bevisad slutleverans.

**Gate 4: kontrollerad leverans.** Ge Aura ett `proposeArtifactPatch(artifactId,revisionId,targetOwnedPath)`-flöde; granska diff och externa resurser; kör kodkontrakt/tester och uppdatera evidens. Ingen extern publicering implicit.

**Gate 5: telefon och samarbetsytor.** Aura Phone använder samma artifact-board för godkänd samtalsplan, status, anteckningar och kvitton; faktiska samtal kräver separat operatörsbeslut, exakt nummer, kostnadstak och identifiering av AI-assistent. Agent Replay återspelar observerade events, inte påhittade tankar.

Releasekrav: Node24 Windows och Android där relevant; 390px/1440px; keyboard screen-reader; 100% red-team-fall blockeras; ingen regression i port 3000, original/draft eller övervakning; real browser/CDP/post-restart evidens; om `CI` fortfarande har 0 steg så är den **blockerad, inte godkänd**.

## UX-riktning

**Artifact Board**: överst *Auras fynd* (källkort: HTML, foto, text, agentresultat). Välj ett kort för mittenyta och höger inspektör: `Visa original / Redigera kopia / Jämför / Spara utkast / Föreslå ändring`. Vid riktiga testfel visas `Problems`; vid aktiva CDP-operationer visas browser target och screenshot. Ingen statisk terminal som enda insyn, ingen fejkad agentstatus.

Ingen tldraw-dependency i första implementation: referenskällan inspirerar kort och annotationer, men 2026 års tldraw SDK-licens kräver särskilda produktionsvillkor. React-UI med egna begränsade bildannoteringar ger en tillgänglig MVP utan licenslåsning. React Flow är MIT men ska inte introduceras bara för dekoration.

## Forskningsreferenser

- Chrome DevTools Local Overrides: https://developer.chrome.com/docs/devtools/overrides/
- Browserbase observability: https://www.browserbase.com/observability
- Playwright Trace Viewer: https://playwright.dev/docs/trace-viewer-intro
- MDN srcdoc and iframe sandbox security: https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc
- OWASP SSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- tldraw licensing: https://tldraw.dev/community/license
- React Flow MIT: https://xyflow.com/open-source

## Dokumenterat och inte utfört

**Verifierat lokalt:** sandboxad frontend-prototyp exekverades med headless Chromium, 15/16 funktionella tester passerade. Ett underkänt nätverksförsökstest redovisas. Inga riktiga AI-underagentprocesser exekverades; inga GitHub-forks, ändringar i JACO:s live-UI, telefonanrop, CDP-mutationer eller projektpublicering gjordes i denna simuleringsomgång.
