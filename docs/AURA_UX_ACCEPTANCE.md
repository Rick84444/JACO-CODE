# Aura Live Workspace – produktkrav och UX-acceptans

**Status:** Kvalitetsmål, inte ett uppmätt användarbetyg. Den här specifikationen gäller den enda kanoniska Aura-ytan på Windows och Android/Termux. Inget separat demo-GUI får användas som bevis för leverans.

## Kärnflödet som måste fungera

1. Öppna JACO → befintligt projekt och **en** chatt visas. Om runtime eller modell saknas får användaren ett begripligt läge, inte ett påhittat READY.
2. Skriv ett mål → uppdraget får ett beständigt ID. Aura får arbeta autonomt enligt vald policy. Ett mottaget mål räknas **inte** som ett utfört uppdrag.
3. Följ senaste arbete → verkliga händelser och deras verifieringsstatus syns i Live Stage. Fel, osäkert utfall och frånkoppling går inte att förväxla med leverans.
4. Öppna **Kod**, **Förhandsvisa** eller **Belägg** med ett klick på datorn, eller via mobilens tydliga Arbete-flik och meny. Den pågående chatten och osparade utkastet består vid varje byte.
5. Granska ändrad fil → diff/ändringsstatus och testkvitton är kopplade till rätt uppdrag. Förhandsvisningen isolerar okänd HTML. Spara kräver att filversionen fortfarande matchar; ett konfliktfel får inte skriva över användarens eller agentens ändringar.
6. Byt projekt, avbryt en operation, starta om eller tappa nätet → inget gammalt material visas som aktuellt i det nya projektet. Om ett externt utfall är okänt måste runtime först undersöka vad som verkligen hände.
7. Kostnader: autonomi börjar på nivå 5, frivillig sänkning ska vara enkel. Anslutna betalda AI-API:er använder användarvalda kostnadstak; köp av abonnemang, påfyllning och utbetalningar behöver uttryckligt användargodkännande.

## Mätbar kvalitet – operatörens 8/10-mål

**I nuvarande utvecklingsfas är ägaren den enda UX-testpersonen.** Automatisk CI-verifiering och det mänskliga användarbetyget är skilda mått. Kravet på fem externa testpersoner tas bort: det gäller varken för att fortsätta utveckla, godkänna GUI:t internt eller slå samman en tekniskt verifierad implementation.

### Steg 1: tekniska tester utan operatörsbörda
GitHub Actions verifierar byggen, navigation, kontinuitet, browser/HTML-isolering och tester. Misslyckad CI är ett tekniskt blockerande fel; ett godkänt CI-test är **inte** ett påhittat användarbetyg.

### Steg 2: verklig operatoracceptans
På **sin egen Windows-installation** använder operatören Aura för verkliga uppdrag, inklusive att starta, följa, granska resultat, rätta önskad ändring och återuppta efter avbrott. Operatören ger efteråt ett övergripande betyg **1–10** och beskriver vad som fungerar eller stör. **Mål: operatörens betyg ≥ 8/10**, utan P0-blockerare. Betyget ska aldrig anges som uppnått förrän operatören uttryckligen har lämnat det.

### Steg 3: Androidacceptans när en körbar version finns
Samma person bedömer Android separat, på sin riktiga telefon, efter att installationen fungerar. Windowsbetyget är inte bevis för mobilbetyget. Ingen extern testpanel krävs för denna interna fas.

### Steg 4: framtida extern validering
Om JACO senare ska marknadsföras mot andra användare bör oberoende användare rekryteras. Ett sådant test får ett separat urval och resultat. Det är **inte** ett villkor för operatörens nuvarande acceptans.

### Operatörens enkla betygsmall
Efter att ha genomfört ett verkligt uppdrag räcker följande: **Helhetsbetyg 1–10**; **vad kändes smidigt?**; **vad störde mest?**; **skulle du hellre använda Aura än din nuvarande arbetsyta?**. Inga påhittade medianvärden eller uppskattningar från utvecklaren.

| Dimension | Test | Stoppspärr |
|---|---|---|
| Start / onboarding | Anslut lokal modell eller använd redan ansluten; starta ett uppdrag | Inga dolda shell-steg |
| Uppdragsförståelse | Peka ut aktuellt steg, senaste verifierade åtgärd och nästa åtgärd | Ingen falsk färdigmarkering |
| Navigation | Gå mellan chatt, kod, resultat och bevis på desktop och 393 px mobil | Inga döda knappar eller oåtkomliga vyer |
| Kontinuitet | Byt vy, projekt, ladda om och avbryt SSE | Utkast bevarade, historik deduplicerad, inga andra projekts bevis visas som aktuella |
| Kod / preview | Ändra HTML, se förhandsvisning, utlös versionskonflikt och återhämta | Inga tysta överskrivningar, ingen script-escape |
| Återhämtning | Avbryt en extern åtgärd mellan utförande och kvitto | Ingen blind upprepning av icke-idempotent åtgärd |
| Ekonomi / autonomi | Begränsa autonomi och prova köp respektive vanligt modell-anrop | Utgifter stoppas utan godkännande, egna molntak respekteras |

## Teknisk verifiering före merge

- TypeScript och produktionsbygget gröna, inklusive frontendens faktisk använda assets.
- Node-regression: stage selection, falsifierbar beläggstatus, stage pin/unpin, projektbytesisolering, HTML-sanering, filer och CDP read-only.
- Playwright genom **det verkliga React-gränssnittet** på 1440×900 och 393×852: navigering, uppdragsstatus från beständig fixture, arbetskopia, filkonflikt, SSE reconnect, mobiloverflow och nedkopplat läge. Mockservern får inte räknas som ett användartest.
- På målmaskin: verkligt autonomt end-to-end uppdrag med commit, diff, tester, kvitton och restart. Dokumentera exakt JACO-release, SHA, modell/provider, OS och pass/fail per test.
- Beslut att merge:a kräver gröna relevanta CI-kontroller. En lyckad mock eller bara en godkänd screenshot är inte en produktrelease.

## Kända begränsningar vid införandet

Aura Live Stage är en separat utvecklingsgren tills den integreras med senaste `main`. CDP-stills är periodiska bilder, inte en videoström; browseraktionen sker via separat kontrollerad verktygsgräns. Nuvarande live-events saknar fullständig projektskopad historik: vid projektbyte döljs äldre stage-händelser tills nya observationer kommer. Sann per-projekt-historik behöver projekt-ID i strömmen. Android på telefon, verklig autonom exekvering och användarbetyg är ännu inte verifierade.

**Definition av färdig för nuvarande GUI-acceptans:** Ett verkligt uppdrag fungerar och kan granskas från Aura på målmaskinen, relevant CI är grön, och operatören ger minst 8/10 utan P0-blockerare. Windows och Android bedöms separat när respektive version kan köras. Ingen extern testpanel krävs.
