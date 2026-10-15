# Disclaimer / Ansvarsfriskrivning

## English

JACO is a development project published for free use under the MIT License (see `LICENSE`). Copyright remains with the
holder named in `LICENSE`.

- **No warranty.** The software is provided "as is", without warranty of any kind. The authors and copyright holder are
  not liable for any claim, damages, data loss, costs or other liability arising from its use (MIT License).
- **It acts on your computer.** JACO's agents can run commands, edit and delete files, open a browser and call paid model
  providers. Run it in a separate user account, a virtual machine or a sandbox, and review what it is allowed to do.
- **Use your own keys and limits.** The repository contains no keys, wallets or accounts. You supply your own provider keys
  and set your own cost limits (`dailyCloudUsd`, `monthlyCloudUsd`, `maxCloudUsdPerTask`). You alone are responsible for
  costs you incur with third-party services.
- **No payments by default.** Payment and marketplace features stay off until you configure your own receiver
  (`JACO_PAYMENT_RECEIVER`) and accounts. Outgoing payments require operator approval.
- **Status.** Parts are verified with automated tests; other parts are experimental. See "Status" below. Do not use it for
  anything where a failure could cause harm.

## Svenska

JACO är ett utvecklingsprojekt som publiceras för fri användning under MIT-licensen (se `LICENSE`). Upphovsrätten
tillhör den som anges i `LICENSE`.

- **Ingen garanti.** Programvaran tillhandahålls "i befintligt skick" utan garantier. Upphovsrättsinnehavaren och
  upphovsmännen ansvarar inte för krav, skador, dataförlust, kostnader eller annat som uppstår vid användning.
- **Den agerar på din dator.** Agenterna kan köra kommandon, ändra och radera filer, öppna en webbläsare och anropa
  betalda modelltjänster. Kör den i ett separat konto, en virtuell maskin eller en sandlåda.
- **Använd egna nycklar och gränser.** Repot innehåller inga nycklar, plånböcker eller konton. Du anger dina egna och
  ansvarar själv för kostnader hos tredjepartstjänster.
- **Inga betalningar som standard.** Betal- och marknadsplatsfunktioner är avstängda tills du anger egen mottagare
  (`JACO_PAYMENT_RECEIVER`) och egna konton. Utgående betalningar kräver operatörens godkännande.
- **Status.** Delar är verifierade med automatiska tester, andra är experimentella. Se nedan. Använd den inte där ett fel
  kan orsaka skada.

## Status (2026-10-15)

| Verified by tests or a recorded run | Experimental or known issue |
|---|---|
| JACO Lite starts from a clean folder (release verification, mock model) | Real on-device inference on Android/Termux |
| Local models through Ollama answer through the runtime | WhatsApp two-way channel with a real phone |
| Live cost: measured spend, prepaid balance, daily cap | Agent-to-agent marketplace with external partners |
| Gameboard and MCP tools ship in the Lite package | Nova planning fails on a share of tasks and can stall |
| Voice channel and QR rendering (unit tests) | Windows launcher test for an incomplete extraction |
