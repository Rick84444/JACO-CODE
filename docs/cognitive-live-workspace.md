# JACO Cognitive Live Workspace

## Implementerad upplevelse

[REAL] Den kanoniska klienten är ombyggd kring en enda konversation. JACO:s befintliga logotyp, mörka färgskala och projektverktyg finns kvar. Samtal är startvyn; kod, förhandsvisning och belägg öppnas utifrån arbetet. Terminal, Git, modeller, färdigheter, enheter och budget är fortfarande kopplade till befintliga funktioner.

Formen utgår från tre frågor: vad försöker vi göra, vad har observerats och vad kan faktiskt styrkas? Därför finns uppdraget nära skrivfältet, verkliga arbetshändelser i samma tidslinje som samtalet och resultatets underlag i en kontextuell arbetsyta. Användaren behöver inte följa interna agentnamn eller hålla flera chattar öppna.

[REAL] `Fråga` skickar en fråga om det aktuella arbetet. `Uppdrag` registrerar ett nytt mål via den befintliga startkedjan. En registrering visas först efter ett bekräftat uppdrags-ID, både för full runtime och Lite. Ett avvisat anrop bevarar texten. Frågeläget använder en serverbegränsad uppsättning läsverktyg; modellen får inte skapa uppdrag, ändra policy, byta planerande provider eller leverera kod genom den vägen. Ett negativt test försöker uttryckligen välja `start_goal` och kontrollerar att ingen mutation sker.

[REAL] Konversationen förblir monterad vid vybyten, även när den döljs på mobil. Utkast behålls, sparad chatt läses från befintlig krypterad lagring och en misslyckad första läsning kan försöka igen. Frågor får de senaste observerade händelserna och aktuellt uppdrag som kontext. Serverns `current_work`-verktyg kan dessutom läsa underlaget direkt från runtime.

## Händelser och belägg

[REAL] `GET /api/aura/workbench/live` publicerar SSE med schemat `jaco.cognitive-live/v1`. Routens befintliga `requireLocalUi` och projektbindning gäller. Händelser läses från den befintliga SQLite-bussen och den flyktiga runtime-strömmen. Ingen separat händelsedatabas eller ny lyssnande tjänst införs.

| Underlag | Presentation |
| --- | --- |
| Uppdrag registrerat | Mottaget mål, utan påstående om utfört arbete |
| Verktygssteg startat | Faktisk åtgärd och refererad fil när den finns |
| Resultat utan verifiering | Verifiering saknas |
| `ok: true` och `verified: true`, utan motstridigt fel | Verifierat verktygsresultat |
| Fel, misslyckad exitkod eller negativt resultat | Steget misslyckades |
| Okänt utfall | Kontroll behövs innan steget upprepas |
| Ändrad plan med rapporterad orsak | Beslut och den registrerade orsaken |
| Avbruten anslutning | Anslutningen behöver återställas; historik behålls |

[REAL] Berättelsen är en deterministisk sammanfattning av händelsernas begränsade fält. Den genererar ingen intern tankeström eller påhittad aktivitet. Heartbeats och tomma utvecklingscykler filtreras bort. Råa verktygsargument och fullständiga utdata ingår inte i livekontraktet; kända hemligheter och tokenmönster redigeras bort. Ett verifierat steg betyder inte att hela produkten är godkänd.

[REAL] Varje beständig observation har ett sekvens-ID, uppdrags-ID och tidsstämpel. `Last-Event-ID` gör återanslutning möjlig. Beständiga kvitton prioriteras vid dubbletter; flyktiga observationer märks som sådana i beläggvyn. Upp till 300 lagrade rader återspelas per anslutning och klientens flöde begränsas till 400 observationer. Saknad äldre återspelning markeras uttryckligen; äldre lagring raderas inte.

## Live skapande

[REAL] Monaco laddas först när kodvyn öppnas och behålls därefter mellan vybyten så att editorn inte startas om under arbetet. Den initiala klientbunten är cirka 379 kB, jämfört med cirka 3,76 MB före uppdelningen. Kodeditorns hashkontroll, sparfunktion, Git-operationer och befintliga behörighetsgränser används fortsatt.

[REAL] Den öppna filen observeras när kod eller förhandsvisning visas: vid en refererad händelse och annars med tre sekunders intervall. Ett rent dokument uppdateras automatiskt. Om användaren har ett eget osparat utkast bevaras utkastet och dess ursprungliga hash; en motstridig sparning avvisas. Att läsa den nya versionen och ersätta utkastet kräver en uttrycklig handling i gränssnittet.

[REAL] HTML förhandsvisas från aktuellt filinnehåll i en iframe med separat origin, `sandbox="allow-scripts"` och CSP som blockerar externa anslutningar, formulär och bas-URL. Den verifierade browserkontrollen försöker ändra IDE-förälderns dokument och misslyckas. Sammansatta projekt med separata CSS/JS-resurser behöver fortfarande sin vanliga utvecklingsserver; denna första integrerade förhandsvisning är för självständig HTML. Verifierade resultatlänkar kan öppnas separat.

## Verifiering och omfattning

[REAL] Verifierat lokalt med Node 24: full TypeScript-kontroll, produktionsbygge av klient och server, samt 43 kontrakts- och integrationstester. Testerna omfattar transport över en riktig HTTP-socket, SQLite-återöppning, krypterad konversationslagring, misslyckade kvitton, sekretessfilter, gamla GUI-kontrakt och gränsen för frågeverktyg.

[SIMULATED] 15 webbläsarkontroller kör den verkliga produktionsklienten mot en kontrollerad testserver. De använder den riktiga lagringen och SSE-hanteraren; modellsvaret och uppdragshändelserna är testdata. Kontrollerna omfattar desktop och mobil viewport, samma utkast mellan vyer, kontext för frågor, beständig återspelning, editor, isolerad och uppdaterad HTML, skydd av osparade ändringar, återanslutning och korrekta fel vid uppdragsregistrering. Bilderna nedan visar denna kontroll och är märkta i själva bilden.

![Desktop i kontrollerad UI-verifiering](evidence/cognitive-workspace-desktop.png)

![Arbete i kontrollerad UI-verifiering](evidence/cognitive-workspace-live.png)

![Belägg i kontrollerad UI-verifiering](evidence/cognitive-workspace-evidence.png)

![Mobil viewport i kontrollerad UI-verifiering](evidence/cognitive-workspace-mobile.png)

Kör från repository-roten:

```sh
node --test tests/nova/cognitive-live.test.mjs tests/nova/aura-chat-session.test.mjs tests/nova/aura-truthful-gui.test.mjs tests/nova/aura-gui-audit.test.mjs tests/nova/nova-activity-text.test.mjs tests/nova/aura-seer-chat.test.mjs
npm --prefix runtime run lint
npm --prefix runtime run build
JACO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/nova/cognitive-workspace.browser.mjs
```

[REAL] GitHub-workflowen `Cognitive Live Workspace` bygger klient/server och kör kontrollerna på Node 24 med Chromium. Browserverktygen installeras separat från produktens beroenden.

[UNKNOWN] Operatörens Android/Windows-runtime, riktig modellinferens, Workplace-registrering och publicerad IDE har inte kunnat köras i denna miljö. Workplace på loopback var otillgänglig; utvecklingen utfördes i en isolerad gren med status `DEGRADED_UNSYNCED`. Det här är verifierad kod och en kontrollerad UI-integration, inte ett påstående om uppdaterad telefon eller driftmiljö.

[SPEC] Den återstående 2027-visionen är rikare rapporterade delmål, orsaker till tekniska beslut, projektspecifik historik och verifierad erfarenhet som återanvänds mellan uppdrag. Den här ändringen bygger upplevelsen och kopplingen till befintlig runtime; den inför ingen ny planerare, självlärande motor eller agentarkitektur.
