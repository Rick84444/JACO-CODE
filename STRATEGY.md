# JACO — strategiankare

Den här filen är det bestående minnet mellan sessioner. Ingen agent, ingen chatt
och ingen människa förväntas minnas kontexten. Allt som gäller står här.

**Läs den här filen FÖRST i varje ny session. Uppdatera den SIST, innan du slutar.**

Senast uppdaterad: 2026-10-22 av Claude (Dispatch-session), på uppdrag av Rick.

---

## 1. Målet

Bygga jacocode.com till en infrastruktur där AI-agenter kan hitta varandra,
samarbeta, utföra uppdrag, få resultatet verifierat och få betalt för verkligt
arbete. Fullständig vision: se `VISION.md` om den finns, annars Ricks
beskrivning i konversationen 2026-10-22.

## 2. Två spår — håll dem åtskilda

Det här är den viktigaste strukturella insikten i filen. Spåren blandas lätt
samman, och då byggs infrastruktur i väntan på intäkt som aldrig kommer.

### Spår A — Första intäkten
Mål: en betalande kund. Inte nätverksbevis.

Troligaste vägen: EN av de befintliga a2a-agenterna gör betalt arbete för en
människa. Ingen A2A-delegering, ingen Trust-certifiering, ingen marknadsplats.
Manuell leverans är tillåtet.

Flaskhals: det finns inget definierat erbjudande och ingen identifierad köpare.
Tekniken är inte flaskhalsen.

### Spår B — Nätverksbeviset
Mål (Ricks formulering, avsnitt 6 i visionen): två oberoende agenter som
registrerar sig, upptäcker varandra, utför ett verkligt uppdrag och levererar
ett verifierat resultat — helt genom JACO:s protokoll, reproducerbart.

Detta är rätt milstolpe eftersom den är falsifierbar. "100 anslutna agenter"
är det inte.

Spåren får köras parallellt. De ska inte ha samma plan.

## 3. Moaten är verifieringen, inte agenterna

Den långsiktiga fördelen ska vara en verifierbar kunskapsbas byggd på faktiskt
utfört arbete. Det håller bara om verifieringen är svår att lura. Om Trust går
att övertala blir historiken värdelös som signal.

Nuläget talar emot att verifieringen är stark. Se avsnitt 5.

## 4. Hårda begränsningar — får inte brytas

- Ingen autonom checkout. Ingen agent genomför köp eller flyttar pengar.
- Betalningsbehörighet kräver en ansvarig juridisk eller fysisk person.
- Registrering, säkerhetscertifiering och betalningsbehörighet är tre separata
  saker. En registrerad agent är inte betrodd och kan inte ta emot pengar.
- Inga fabricerade siffror, kunder eller testresultat. Osäkerhet skrivs ut som
  osäkerhet.
- 0.17-rapporten satte A2A-säljprototypen i karantän för "fabricated seed data
  and unsafe autonomous checkout". Den får inte tillbaka in i produktion utan
  att båda problemen är lösta.

## 5. Verifierat nuläge (2026-10-22)

Bara saker som faktiskt kontrollerats. Allt annat hör i avsnitt 6.

**Repo** `C:\Users\dickj\Documents\GitHub\JACO-CODE`
- origin = `github.com/Rick84444/JACO-CODE` (fem fyror)
- Gren: `integrate/aura-live-stage-20261022`, 61 commits före `origin/main`,
  inte pushad. 29 filer, +1563/−78.
- Ändringar i `agents/jaco-cli.mjs`, `agents/lib/activate.mjs`, ny
  `tests/nova/activate-remote.test.mjs`.
- Tester: 730/753 gröna. 9 röda — alla 9 röda även på `origin/main`, som har 10.
  Grenen är alltså ingen regression.
- De röda: tre `termux-boot-activate` (körbarhetsbit, troligen Windows),
  `nova/lite` (1!==3), `nova/bland` (438!==384), `nova/planner-choice` (saknad
  exception), `workspace-integrations` (MCP-kommando i valt projekt),
  `termux-core-identity` (JSON-parser), ett setup/manifest deep-equal.
- Inget typecheck-script finns. `npx vite build` dör på saknad `index.html` i
  roten — troligen fel buildkommando, rätt kommando ej identifierat.
- En stale `.git/index.lock` flyttad till
  `.git/index.lock.stale-20261022-1902.bak`.

**Cloudflare** — 29 workers. Kommersiellt relevanta:
- `jaco-site`, `jaco-landing`, `jaco-license`, `jaco-inbox`
- a2a-agenter: copywriter, seo-optimizer, data-analyst, marketing-analyst,
  video-editor, cyber-auditor, smart-contract-auditor, coding-reviewer,
  image-generator, global-translator, smart-calculator, premium-html-builder

**Gammal stack kör lokalt** — port 3000 hålls av `node dist/server.cjs`
(startad 2026-10-21 17:30). Runt den: en andra `dist/server.cjs`,
workplace-server, seer-start, a2a-server, nova-bridge, cdp-bridge,
chatgpt-nova-gateway, remote-bridge, hands-off-agent. Ej stoppade.

## 6. Öppna frågor — det här vet vi inte

- Vilket är erbjudandet? Vem är första köparen? (blockerar spår A helt)
- Vilka a2a-agenter levererar något en kund betalar för, och vilka är skal?
- Hur långt når `jaco-license`? Finns en implementerad betalningsväg?
- Finns ett pris formulerat i `jaco-site` eller `jaco-landing`?
- Tar `jaco-inbox` emot leads?
- Vilket är det rätta buildkommandot?
- Orsaken till de 9 röda testerna är inte undersökt.
- Termux, Android och faktisk Aura-funktion är inte verifierade på målhårdvara.

## 7. Väckningsprotokoll

Ingen session är kontinuerlig. Loopen är det bestående, inte agenten.

Vid start:
1. Läs den här filen.
2. Läs avsnitt 5 och 6. Lita inte på minnet — kontrollera det som är kritiskt.
3. Välj EN sak ur avsnitt 8. Inte flera.

Vid slut:
1. Flytta det du verifierat från avsnitt 6 till avsnitt 5, med datum.
2. Skriv in nya öppna frågor i avsnitt 6.
3. Uppdatera avsnitt 8.
4. Skriv vad som INTE gick, och varför. Misslyckanden är det som sparar mest
   tid nästa gång.

Regel: hitta inte på status. Står det inget i avsnitt 5 är det inte verifierat.

## 5b. Integritetsfynd 2026-10-22 — åtgärdas före intäktsarbete

Hittade vid kartläggningen. De här är integritetsbuggar, inte funktionsbuggar:
de gör den verifierbara kunskapsbasen värdelös som signal, vilket är hela
moaten enligt avsnitt 3.

1. **Webhook godkänner förfalskade betalningar.**
   `runtime/src/adapters/paymentAdapter.ts:127-141` — `OfflineLedgerPaymentAdapter`
   godkänner vilken JSON som helst som `payment.succeeded`, och används när
   `STRIPE_SECRET_KEY` saknas (`:157`). Routen i `runtime/server.ts:~4462`
   kräver bara att någon `x-webhook-signature`-header finns, inte att den
   stämmer — och bokför sedan "[INTÄKT BOKFÖRD]" i Auras minne.
2. **Påhittad evidens märkt "[REAL]".**
   `src/components/VerifiedMarketplacesView.tsx:216-219` slumpar latens med
   `Math.random()` och visar det som genomfört anslutningstest.
3. Förifyllda betal- och poängkommandon i `src/components/A2AWorkflowDashboard.tsx:~350`
   (`skyfire_pay` 1,5 USDC med inbyggt seller_service_id; `readiness_score`
   med färdiga poäng).
4. Marknadsföring av "12 agents at $4-$20" i `hands-off-agent.mjs:2077` —
   bara tre av tolv har betalningslänk, ingen leverans verifierad.
5. Operatörsspecifikt i repot: hårdkodade Stripe-länkar i
   `src/components/QuickCheckout.tsx:17-34` och `dickjacobsson022.workers.dev`
   i `PAID_DELIVERY.md`. Strider mot `AGENTS.md`. **Blockerar första push.**
6. Prismotsägelse: `skills/community-post/SKILL.md` säger 0,50 USD per scan,
   koden säger 9 USD (`skyfire-seller.mjs:17`).

Operatörsbeslut 2026-10-22: 1 och 2 åtgärdas först. 3, 5, 6 därefter.
5 måste vara åtgärdad innan något pushas.

## 5c. Vad som faktiskt finns kommersiellt (2026-10-22)

**Verklig, testad kod — drift ej verifierad:**
- `POST /v1/repo-scan` (`agents/lib/repo-scan.mjs`) — läckta nycklar maskerat,
  sårbara beroenden via OSV.dev, HTML+JSON-rapport. Pris 9 USD
  (`skyfire-seller.mjs:17`), betalning x402 (USDC på Base) eller Skyfire.
  Kräver `X402_PAY_TO` och `JACO_GATEWAY_PUBLIC_URL`.
- `/v1/verify` (`agents/lib/verify-api.mjs`) — 0,02 USD per kontroll,
  25 gratis per dag och klient.
- 21/21 tester för repo-scan, verify-api, x402, skyfire och gateway passerar.

**Tre enda erbjudanden med formulerat pris** — `src/components/QuickCheckout.tsx:17-34`:
smart-contract-auditor 200 SEK, cyber-auditor 150 SEK, data-analyst 120 SEK.
Saknas: `src/`-appen serveras ingenstans (ingen `index.html` i roten) och
`PRODUCT_MAP` kopplar inte länkarna till rätt tjänst.

**Licensvägen** — Stripe-länk → webhook → nyckel → `POST /run` med `X-JACO-Key`.
Saknas enligt `PAID_DELIVERY.md`: riktig `STRIPE_WEBHOOK_SECRET` (platshållare
nu), success-URL, `PRODUCT_MAP`, och workerkällkoden i repot.

**Workerkällkoden saknas helt.** `docs/PAID_DELIVERY.md` pekar på
`scratchpad/workers/patched/*.js` — mappen finns inte, varken på disk eller i
git-historiken. `tests/workers/license.test.mjs:4-5` kraschar därför.
Konsekvens: vad de tolv a2a-workerna levererar går inte att granska.

**Nio av tolv agenter är namn och pris i `agents/skills.config.mjs`, inget mer.**
copywriter, seo-optimizer, marketing-analyst, video-editor, image-generator,
global-translator, smart-calculator, premium-html-builder, coding-reviewer.
`openapi-jaco.json` har bara `/health`.

**`jaco-inbox`** (`gateway/cloudflare/jaco-inbox-worker.mjs`) är en e-postworker
för verifieringsmail, inte ett leadflöde. Sparar bara `jaco`-adresser, 48 h,
max 200 meddelanden. Standarddomän `mimirpower.com` i koden.

**`jaco-site` och `jaco-landing`** — ingen källkod, ingen prissida.
`docs/product-distribution.md:9`: jacocode.com saknade webbadress och
Worker-routes 2026-10-05. `:15`: priser "undecided".

**Commerce-routern** `gateway/src/commerce/` — `pay()` importeras ingenstans,
`agent-connect` och `p3p` är stubbar.

## 8. Nästa steg

Ett steg i taget. Den som gör det uppdaterar den här listan.

1. **Pågår** — åtgärda integritetsfynd 1 och 2 (avsnitt 5b). Lokal commit,
   ingen push. Plus regressionstester som fallerar om de återinförs.
2. **Nästa** — läs en verklig körning av `a2a-smart-contract-auditor/run` mot
   ett litet känt kontrakt. Om svaret är generisk LLM-text går det inte att
   sälja som revision för 200 SEK, och spår A måste byta produkt. Det här
   enda anropet avgör vilken produkt som är först.
3. **Därefter, beroende på 2** — antingen färdigställ licensvägen (Stripe-secret,
   success-URL, PRODUCT_MAP, workerkällan in i repot), eller sälj repo-skanningen
   via en vanlig Stripe-länk med manuell leverans. Repo-skanningen är
   deterministisk och testad, vilket auditorn inte är visad vara.
4. **Blockerad av fynd 5** — rensa operatörsspecifik data, därefter pusha de
   61 commitsen. PR #13 beslutas separat.
5. **Öppen fråga till Rick** — vad gör PID 29776 (`dist/server.cjs`, port 3000,
   startad 2026-10-22 19:33)? Den gamla stacken i övrigt är stoppad.

Noterat: steg 2 är billigt och avgör steg 3. Gör inte steg 3 först.

## 9. Vad JACO-stacken ska göra, och vad den inte kan

JACO/SEER kör på sina egna modeller och sin egen runtime. Det är den delen som
kan arbeta utan att en Claude-session är öppen, och den som bör göra det
löpande arbetet.

Vad som inte går: en Claude-session kan inte göras persistent. Att låta JACO
anropa Claude som underagent kräver API-nyckel och kostar per token — det
flyttar kostnaden, det sparar den inte. Kontinuiteten ligger i den här filen
och i JACO:s egen runtime, inte i en modell som "fortsätter".
