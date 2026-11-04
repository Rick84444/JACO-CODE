import { generate, GenerateResult } from './poolManager.js';

// Implements the MAI pattern (Explorer → Falsifier → Synthesizer) for
// decisions that deserve deeper reasoning — i.e. replanning, not every
// single "continue to the next step". Explorer = DeepSeek (default,
// cost-effective). Falsifier = local model, but with an EXPLICIT
// instruction to look for faults, not to confirm. That is the difference from
// just asking two models the same thing — the Falsifier is not rewarded for
// agreeing.

export interface AdversarialResult {
  proposal: string;
  critique: string;
  survived: boolean;
  finalAnswer: string;
  explorerProvider: string;
  falsifierProvider: string;
}

export const FALSIFIER_SYSTEM_PROMPT = `
You are a falsifier, not an assistant. Your only job is to find faults,
weaknesses, hidden assumptions or better alternatives in the proposal below.
Do NOT agree unless there are good reasons. If the proposal is weak,
explain exactly why and suggest an alternative direction.
Respond ONLY with JSON: { "verdict": "survives" | "rejected", "critique": "..." }
`.trim();

export function parseFalsifierResponse(raw: string): { verdict: 'survives' | 'rejected'; critique: string } {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Cannot be parsed: treat as a strict rejection — better to force a synthesis round
    // than to let an unparseable answer count as approved.
    return { verdict: 'rejected', critique: `The falsifier's answer could not be parsed: ${raw.slice(0, 200)}` };
  }
}

/**
 * Runs a full adversarial round. Used by decideNextStep during
 * replanning (needsReplanning === true) — more expensive in time/calls, so it
 * should not run for every small step, only when the strategy actually
 * needs to be challenged.
 */
export async function reasonAdversarially(question: string, context: string): Promise<AdversarialResult> {
  // Step 1: Explorer — DeepSeek / primary model proposes, by default.
  const explorerPrompt = `${context}\n\nQuestion: ${question}\n\nGive your best proposed solution/strategy.`;
  const proposal: GenerateResult = await generate({ prompt: explorerPrompt });

  // Step 2: Falsifier — local model / reviewer, forced to look for faults.
  const falsifierPrompt = `Proposal to review:\n${proposal.text}\n\nContext:\n${context}`;
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

  // Step 3: Synthesizer — force the Explorer to rethink with the critique as input.
  // This is the actual "new way of thinking" step: DeepSeek may not just
  // repeat its first answer, it must address why it failed.
  const synthesisPrompt = `
Your previous proposal failed review:
${proposal.text}

Critique:
${falsified.critique}

Give a revised proposal that concretely addresses the critique. Do not repeat
the original proposal unchanged.
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
