# JACO Laser Vision — installations- och verifieringsmanual

**Status (2026-11-21): implementerad och CI-testad, INTE livsverifierad på operatörens Windows/Hyper-V-gäst.** Den här sidan dokumenterar **vad som finns i kod och hur man konfigurerar det**, inte en påstådd installation som redan har gjorts på någon specifik dator.

Detta är den sammanhållna manualen för Vision i [Aura Desktop](AURA_DESKTOP_TOOL.md). Den gäller den **kanoniska Aura Runtime** efter PR #362, inte ett separat Visio-program, en ny agent eller en ny fjärrskrivbordsserver. [Desktop AgentOS](DESKTOP_AGENTOS.md) beskriver semantiska Windows-uppdrag; [OpenSpec](../openspec/changes/harden-aura-desktop-e2e/specs/aura-desktop-live/spec.md) specificerar säkerhetskraven.

## 1. Arkitektur och ansvar

```text
Operatören -> Aura/SEER -> Nova Mission Bus och signerade mandat
                                     |
                             Desktop AgentOS
                                     |
                   +-----------------+-----------------+
                   |                                   |
          Windows UI Automation                 Laser Vision
          desktopHandsOff.ts                    hands-off-agent.mjs
          jaco-uia-bridge.ps1                   input-bridge.ps1
                   |                                   |
          DOM/Manifold Traction                PNG + ROI + SHA-256
                   |                                   |
                   +----------- Mission receipts ------+
                                     |
                 mission-screen-frame.mjs (färskhet och hash)
                                     |
               +---------------------+--------------------+
               |                                          |
        Aura GUI Live Stage                       SEER-planerare
        verifierad stillbild                   pixels endast vid opt-in
               |
       Chrome Remote Desktop (separat operatörsvy)
```

- **Skärmfångst:** `agents/input-bridge.ps1` läser den aktiva Windows-skärmen med Win32/`CopyFromScreen`. Den kan ta full bild eller ROI, med skala och verkligt skärmursprung. Detta är **inte** en Google-API-integration.
- **Uppdragskvitto:** `agents/hands-off-agent.mjs` skapar skärmbilden och registrerar bildhash och geometri. `agents/lib/mission-screen-frame.mjs` godkänner endast samma missions färska och oförändrade PNG; den tar hänsyn till senare åtgärder som gör observationen gammal.
- **Perception och målbindning:** UIA ger HWND, PID, fönstergränser och semantiska kontroller; `runtime/src/server/desktop/desktopTraction.mjs` kontrollerar mål mellan två observationer. Win32-mus och tangentbord kräver en färsk uppdragsbunden observation. En klick-dispatch är **inte** verifierat måluppfyllande.
- **En enda aktuator:** `ModelRelay`, befintliga mandat och single-writer leases avgör om en åtgärd får utföras. `agents/lib/input-bridge-daemon.mjs` serialiserar rå input och upprepar inte okända mutationer automatiskt.
- **Extern visning:** Chrome Remote Desktop, installerat **inne i gästen**, ger kontinuerlig mänsklig visning. Hyper-V VMConnect är lokal reserv från värddatorn. Auras GUI visar verifierade *stillbilder*, inte videoström.

## 2. Förutsättningar

1. En Windows-värddator med Hyper-V aktiverat och en **redan skapad**, licensierad och separat Windows-gäst. Hjälpskriptet `agents/aura-desktop-vm.ps1` skapar **inte** en VM och verifierar inte isolering.
2. Kontrollera gästnät, delade mappar, urklipp, enhetsvidarebefordran och privilegier manuellt. Dela inte värddatorns hemligheter eller användarprofil med gästen. Enbart ett VM-namn är inte säkerhetsbevis.
3. Windows och **Node.js 24+** i gästen, med kanonisk `JACO-CODE`-checkout, beroenden och `runtime/scripts/windows/jaco-uia-bridge.ps1`.
4. **En** aktiv Aura Runtime för mission-ledgern. Låt inte en Aura på värddatorn och en i gästen köra samma uppdragskö. Använd inte session 0, Windows-tjänsteskrivbordet, låst Winlogon eller UAC-secure desktop.
5. Operatörens åtkomst till gästen via VMConnect eller Chrome Remote Desktop. Konfigurera Chrome Remote Desktop separat genom [Googles fjärrskrivbord](https://remotedesktop.google.com/access), med operatörens egna autentiseringsflöde. JACO installerar eller loggar inte in i Google automatiskt.

**Säkerhetsregel:** Exponera aldrig JACO Core (:3000), Nova (:4243), Sentinel (:2999), CDP (:9222) eller gäst-RDP direkt mot internet. För den befintliga fjärr-PWA:n gäller befintlig autentiserad Cloudflare Access-konfiguration.

## 3. Installationsföljd

Kör följande **på Windows-värden**, från JACO-checkouten som innehåller hjälpskriptet. Detta visar bara VM-status, startar den förskapade gästen och öppnar en lokal vy:

```powershell
.\agents\aura-desktop-vm.ps1 -Action Status
.\agents\aura-desktop-vm.ps1 -Action Start
.\agents\aura-desktop-vm.ps1 -Action Open
```

Om `AURA_DESKTOP_VM_NOT_FOUND` returneras: skapa först gästen `JACO-Aura-Desktop` i Hyper-V Manager (eller ange dess faktiska namn med `-VMName`). `OPEN_REQUESTED` betyder endast att VMConnect-fönstret öppnats, **inte** att Aura fungerar.

Kör därefter följande **inne i den interaktiva Windows-gästen**, från gästversionen av JACO-checkouten:

```powershell
# Granska och säkerhetskopiera existerande .env innan setup.
# Kör utan rå mus/tangentbord första gången:
.\agents\setup-desktop-agentos.ps1 -InstallDependencies
.\agents\start-all.ps1
```

`setup-desktop-agentos.ps1` skriver/uppdaterar `.env`, kan skapa ett lokalt gateway-token och sätter `JACO_EXECUTOR=desktop-agentos`. Det konfigurerar också vissa befintliga autonomi-/shell-flaggor; **granska diffen i .env och dina befintliga mandat innan du kör det**. Det skapar inte VM-isolering, Google-inloggning eller ett färdigt uppdrag. `-InstallDependencies` använder npm i `runtime/`.

När den semantiska vägen och gästisoleringen är verifierade kan operatören **uttryckligen** välja rå Win32-input:

```powershell
.\agents\setup-desktop-agentos.ps1 -EnableSandboxInput
.\agents\start-all.ps1
```

Detta kontrollerar Windows CIM-uppgifterna för Hyper-V-gäst och sätter `JACO_AURA_DESKTOP_SANDBOX=hyperv-guest`, `JACO_ALLOW_COORDINATE_FALLBACK=1` och `JACO_AURA_DESKTOP_SCREEN_VIEW=1`. Det är **inte** i sig ett godkännande för varje åtgärd; missionens `allowedTasks`, målbinding, gästsession och signerade mandat prövas fortfarande.

För att inskränka vilka applikationer UIA får styra, använd vid behov det befintliga tidsbegränsade desktop-grantet, till exempel:

```powershell
.\agents\grant-desktop-agentos.ps1 -Processes @('notepad') -Hours 1
```

Grantet ersätter **inte** ModelRelay-mandat. Tillåt inte bredare appar än uppdraget kräver och ge aldrig bredare behörigheter för att passera ett test.

## 4. Lokal Vision-diagnostik utan agentåtgärder

Kör detta **i gästens interaktiva session**. `session_status` är läsning av aktuell input-desktop; `screenshot` tar en faktisk lokal PNG och skickar inget till någon modell. **Skärmbilden kan innehålla känsliga data — publicera den inte.**

```powershell
.\agents\input-bridge.ps1 -Op session_status

$probePng = Join-Path $env:TEMP 'jaco-laser-vision-probe.png'
.\agents\input-bridge.ps1 -Op screenshot -OutFile $probePng -MaxWidth 960 -MaxHeight 540
Get-Item -LiteralPath $probePng | Select-Object Length,LastWriteTime
Get-FileHash -LiteralPath $probePng -Algorithm SHA256
# Efter lokal granskning: Remove-Item -LiteralPath $probePng
```

Förväntade observationer: `session_status` rapporterar `jaco.desktop-session/v1`, `interactive=true`, `inputDesktop=Default`, ett positivt `sessionId` och `foregroundHwnd`. `screenshot` returnerar `ok=true`, PNG-fil, faktisk fångstgeometri och `sessionId`. Dessa bevisar **bara** att den lästa sessionen kan observeras; de bevisar inte agentautonomi eller måluppfyllnad.

Valfritt finns ett striktare, **skrivskyddat** gästprobe:

```powershell
.\agents\aura-desktop-acceptance.ps1
```

Det kontrollerar Hyper-V-identitet, session, PNG-signatur/hash, Core och UIA. Resultatets `liveAcceptance=NOT_VERIFIED` är avsiktligt: skriptet kan inte på egen hand bevisa att Chrome Remote Desktop visar samma session eller att Aura slutfört ett uppdrag. Det kan fånga en lokal skärmbild under kontrollen men tar bort den efteråt; publicera inte råa kvitton med privata uppgifter.

## 5. Visa Vision i JACO GUI och för en modell

I **Aura Live Stage → Windows Desktop**:
- Starta ett **autentiserat, aktivt** `desktop-agentos`-uppdrag genom befintlig Aura/SEER-kontroll.
- Klicka **Visa skärmbild**. Panelen använder `GET /api/aura/desktop/live-frame` och visar bara aktuella, missionsbundna PNG-kvitton med korrekt SHA-256/session och högst cirka **12 sekunders** ålder.
- Bilden uppdateras bara när nya uppdragsskärmbilder faktiskt finns; polling med 2,5 sekunders intervall är **inte** videoström eller automatisk skärmfångst.
- Saknas aktiv mission, tillåten skärmvisning, rätt session eller aktuell bild visas avslag/vänteläge. Återanvänd inte en gammal bild som livebevis.

**Sekretessgräns:** `JACO_AURA_DESKTOP_SCREEN_VIEW=1` tillåter lokal autentiserad visning, inte modelluppladdning. `NOVA_ALLOW_CLOUD_IMAGES=1` är ett **separat, uttryckligt** opt-in för att bifoga PNG till SEER-planerare som kan routa till extern modell. Normalläge är av. Om det inte är tillåtet får modellen bara metadata/textnotis och UIA-observationer; den får inte påstå att den sett pixlar.

## 6. Operatörens övertagande och återupptagning

Använd **Ta över** i Windows Desktop-panelen. Aura begär paus via det befintliga Mission Bus-gränssnittet. Vänta på **klar för övertagande**, inte bara ett paus-ACK: `/api/aura/desktop/takeover/:id/status` kontrollerar också att Nova-lease, aktiv uppgift, UIA-writer och ModelRelay DESKTOP-lease är lediga. Okänd lease = **inte klar**.

Öppna Chrome Remote Desktop eller lokalt VMConnect och kontrollera att visningen verkligen är **samma interaktiva gästsession** som Auras input-bridge. Flytta inte musen parallellt med Aura. När du är klar väljer du **Återuppta Aura**; nästa mutation kräver färsk observation och giltigt mandat. Viewer-inloggningen är inte ett JACO-behörighetstillstånd.

## 7. Fysiskt slutprov (ännu inte utfört)

1. Registrera en riktig dedikerad Hyper-V-gäst med granskad isolering och en aktiv, autentiserad Aura Runtime.
2. Bevisa att `session_status`, UIA och Laser Vision läser samma interaktiva Windows-session som operatörens Chrome Remote Desktop/VMConnect-vy. Testa även återanslutning, låsning, upplösning och DPI.
3. Kör genom **den befintliga Aura-missionen** ett harmlöst, avgränsat Notepad-uppdrag: öppna, skriv förväntad text, spara en fil **i gästen**.
4. Läs tillbaka filens **exakta bytes/hash oberoende av modellen**, verifiera minst ett äkta missionskvitto och se korrekt tillstånd i Gameboard. Ett verktygs-`ok` räcker inte.
5. Prova avbruten viewer, fönsterflytt, förlorat fokus, paus/övertagande och återupptagning. Kräva refusal/re-observation efter osäkert resultat, inte blint omklick.
6. Bevara endast sanerade kvitto-ID:n, commit, sessionskontrollens resultat, tider och resultat. Lagra inte konton, skärmpixlar, tokens eller privata enhetsdetaljer i publikt GitHub.

För valfritt sista oberoende filbevis kan gästproben anropas med `-MissionId`, `-ExpectedFile` och `-ExpectedSha256`. Detta är endast en kompletterande verifiering, inte automatisk godkännande av video/session.

**Produktstatus går från `IMPLEMENTED / LIVE NOT VERIFIED` till `LIVE ACCEPTED` först efter verklig operatörsverifiering och bevarade, kontrollerbara kvitton.**

## 8. Vanliga blockerare

| Signal | Vad kontrolleras |
| --- | --- |
| `HYPERV_MODULE_UNAVAILABLE` / `AURA_DESKTOP_VM_NOT_FOUND` | Hyper-V på värd och redan skapad gästdator; inget gästinstallationsscript finns |
| `VIRTUAL_INPUT_HYPERV_GUEST_REQUIRED` | `-EnableSandboxInput` körs faktiskt **inne i** rätt Hyper-V-gäst, inte på värddatorn |
| `VIRTUAL_INPUT_INTERACTIVE_SESSION_UNVERIFIED` | Kör i användarens aktiva desktop, inte service/session 0, låst skärm eller UAC |
| `DESKTOP_SCREEN_VIEW_NOT_ENABLED` | Granska operatörsvalet `JACO_AURA_DESKTOP_SCREEN_VIEW`; ändra inte automatiskt |
| `DESKTOP_FRAME_UNAVAILABLE` / missions- eller session-mismatch | Färsk skärmbild från **samma** mission med giltig hash, korrekt session och ingen senare mutation |
| `DESKTOP_ACTION_STILL_IN_FLIGHT` | Låt Nova-planering, UIA och Relay-lease bli klara efter paus innan manuellt övertagande |
| `DESKTOP_TRACTION_*` | Ny UIA-observation, kontroll av HWND/PID, fokus och unik target; gissa inte koordinat |
| `CANONICAL_RUNTIME_UNREACHABLE` | Kontrollera Core lokalt, dess autentisering och rätt aktiv Runtime; öppna inga publika portar |

## 9. Källor, ändringsspår och begränsningar

- Specifikation: `openspec/changes/harden-aura-desktop-e2e/`, samt `openspec/changes/aura-vision-input-contract/`.
- Exekvering: `agents/desktop-agentos.mjs`, `agents/hands-off-agent.mjs`, `agents/input-bridge.ps1`, `agents/lib/input-bridge-daemon.mjs`.
- Bild- och UIA-verifiering: `agents/lib/mission-screen-frame.mjs`, `runtime/src/server/desktop/desktopHandsOff.ts`, `desktopTraction.mjs`.
- GUI och endpoint: `runtime/src/components/AuraDesktopMonitor.tsx`, `runtime/server.ts`.
- Testgrindar: `.github/workflows/desktop-agentos-gate.yml`, `tests/nova/aura-desktop-live-view.test.mjs`, `tests/nova/desktop-traction.test.mjs`, `tests/nova/aura-desktop-takeover.test.mjs`.
- Ursprunglig implementation: [PR #362](https://github.com/Rick84444/JACO-CODE/pull/362).

**Begränsning:** Denna manual är rekonstruerad och granskad mot incheckad kod. Den dokumenterar **inte** någon redan uppmätt installation på användarens Windows-dator. Godkänd GitHub Actions-CI är inte ett verkligt Chrome Remote Desktop-/Hyper-V-slutprov.
