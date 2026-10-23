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

## Mätbar kvalitet – stoppspärr för 8/10

Ett angivet **8/10** gäller endast om minst fem personer som inte deltagit i utvecklingen utfört uppgifterna på **riktiga installationer**, minst en Android och en Windows. Varje person betygsätter 1–10 efter uppgifterna, utan att ha fått hjälp med terminalkommandon. Redovisa median, spridning, antal och skriftliga observationer. **Godkänt först vid median ≥ 8/10 på respektive plattform**, utan något P0-blockerande problem. Lägre resultat betyder fortsatt förbättringsarbete, aldrig ometikettering av tester som användaromdömen.

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

**Definition av färdig:** Ett hållbart uppdrag fungerar och kan granskas av användaren, på båda plattformarna, med spårbart bevis – och UX-panelens separat insamlade resultat uppfyller 8/10-gränsen.
