import { generate, GenerateResult } from './poolManager.js';

// Implementerar MAI-mönstret (Explorer → Falsifier → Synthesizer) för
// beslut som förtjänar djupare resonemang — dvs replanering, inte varje
// enskilt "fortsätt till nästa steg". Explorer = DeepSeek (default,
// kostnadseffektiv). Falsifier = lokal modell, men med en EXPLICIT
// instruktion att leta fel, inte bekräfta. Det är skillnaden mot att
// bara fråga två modeller samma sak — Falsifiern belönas inte för att
// hålla med.

export interface AdversarialResult {
  proposal: string;
  critique: string;
  survived: boolean;
  finalAnswer: string;
  explorerProvider: string;
  falsifierProvider: string;
}

export const FALSIFIER_SYSTEM_PROMPT = `
Du är en falsifierare, inte en assistent. Ditt enda jobb är att hitta fel,
svagheter, dolda antaganden eller bättre alternativ i förslaget nedan.
Håll INTE med om det inte finns goda skäl. Om förslaget är svagt,
förklara exakt varför och föreslå en alternativ riktning.
Svara ENDAST med JSON: { "verdict": "survives" | "rejected", "critique": "..." }
`.trim();

export function parseFalsifierResponse(raw: string): { verdict: 'survives' | 'rejected'; critique: string } {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Kan inte tolkas som strikt avslag — hellre tvinga en syntes-runda
    // än att låta ett oparseerbart svar räknas som godkänt.
    return { verdict: 'rejected', critique: `Falsifierarens svar gick inte att tolka: ${raw.slice(0, 200)}` };
  }
}

/**
 * Kör ett fullt adversarial-varv. Används av decideNextStep vid
 * replanering (needsReplanning === true) — dyrare i tid/anrop, så det
 * ska inte köras för varje litet steg, bara när strategin faktiskt
 * behöver ifrågasättas.
 */
export async function reasonAdversarially(question: string, context: string): Promise<AdversarialResult> {
  // Steg 1: Explorer — DeepSeek / primär modell föreslår, som default.
  const explorerPrompt = `${context}\n\nFråga: ${question}\n\nGe ditt bästa förslag på lösning/strategi.`;
  const proposal: GenerateResult = await generate({ prompt: explorerPrompt });

  // Steg 2: Falsifier — lokal modell / granskare, tvingad att leta fel.
  const falsifierPrompt = `Förslag att granska:\n${proposal.text}\n\nKontext:\n${context}`;
  const falsifierRaw: GenerateResult = await generate({
    prompt: falsifierPrompt,
    systemPrompt: FALSIFIER_SYSTEM_PROMPT,
  });
  const falsified = parseFalsifierResponse(falsifierRaw.text);

  if (falsified.verdict === 'survives') {
    return {
      proposal: proposal.text,
      critique: falsified.critique,
      survived: true,
      finalAnswer: proposal.text,
      explorerProvider: proposal.providerUsed,
      falsifierProvider: falsifierRaw.providerUsed,
    };
  }

  // Steg 3: Synthesizer — tvinga Explorer att tänka om med kritiken som input.
  // Detta är själva "nytt tankesätt"-momentet: DeepSeek får inte bara
  // upprepa sitt första svar, den måste förhålla sig till varför det föll.
  const synthesisPrompt = `
Ditt tidigare förslag föll för granskning:
${proposal.text}

Kritik:
${falsified.critique}

Ge ett reviderat förslag som konkret adresserar kritiken. Upprepa inte
det ursprungliga förslaget oförändrat.
`.trim();
  const synthesis: GenerateResult = await generate({ prompt: synthesisPrompt });

  return {
    proposal: proposal.text,
    critique: falsified.critique,
    survived: false,
    finalAnswer: synthesis.text,
    explorerProvider: proposal.providerUsed,
    falsifierProvider: falsifierRaw.providerUsed,
  };
}
