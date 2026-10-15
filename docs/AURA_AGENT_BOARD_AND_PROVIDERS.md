# Aura: Agenttavla och provider-val

Agenttavlan är en läsande vy över Workplace och Durable Nova. Rapporterad DONE, agentkontakt och verifierade verktygssteg är skilda observationer; inget av dem ersätter huvudmålets acceptansbevis. Vyn använder Auras befintliga uppdateringsloop och gör inga modell-anrop. Skapande och granskning använder befintliga SEER- och godkännandevägar.

## Byta modell för manuell chatt

1. Välj en registrerad provider i **Aura provider**.
2. Skriv modellnamnet i **Aura modell**. Förslag är inte en låst lista.
3. Valet sparas i denna webbläsares localStorage. **Default** återgår till serverns standard. **Uppdatera providerlista** hämtar nya registreringar; **Hantera providers** öppnar befintlig providerhantering.

Backend skickar ett explicit val genom befintlig ProviderRegistry. Saknad provider, credential eller prissättning ger fel före dispatch; explicit provider byts inte automatiskt. SEER-alternativet använder befintlig SEER-routing. Valet gäller manuell Aura-chatt och ändrar inte Novas autonoma modellkonfiguration.

Molnmodeller kräver konservativ prisinformation. Befintlig Ollama-konfiguration återanvänds. Övriga modeller använder `JACO_AURA_PROVIDER_PRICES_JSON`, med nyckel `provider-id/modellnamn` och positiva `input`/`output` i USD per miljon tokens. Konfigurera verkliga aktuella priser, inte påhittade exempel. Högst 1 USD/dygn inklusive reservationer kontrolleras genom befintlig EconomicGovernor. Saknad usage eller transportfel efter dispatch lämnar reservationen som okänt utfall.

Loopback-endpoints behandlas som lokala, förutom kända/prissatta molnmodeller och modellnamn med `-cloud` eller `:cloud`. En lokal proxy för andra betalmodeller måste därför ha explicit prissättning. Budgeten är en lokal anropsgrind, inte en garanti om leverantörens fakturering eller abonnemangsavgifter. Modellfältet installerar inte modeller eller skapar leverantörskonton.

## Leveransens verifieringsgräns

Verifieringsrapporter ska skilja källkod, byggda artefakter, isolerad runtime och installerad runtime. Browserprov med en kopia av verkliga persistenta uppdrag bevisar visning av den kopian; det bevisar inte att dessa uppdrag exekverades under provet. En installerad server behöver ladda den nya backend- och frontend-versionen innan funktionerna gäller där.
