// Chat utterances are not mission authority merely because they mention a verb.
// Explicit message kinds are the durable contract; plain chat uses a narrow
// imperative fallback. Informational questions always stay in the chat lane.
const INFORMATIONAL = /^(?:how\b|what\b|why\b|when\b|where\b|which\b|who\b|can i\b|could i\b|should i\b|do i\b|does\b|is it\b|tell me (?:how|why|what)\b|explain\b|hur(?:\s|$)|vad(?:\s|$)|varför(?:\s|$)|när(?:\s|$)|var(?:\s|$)|vilken(?:\s|$)|vem(?:\s|$)|kan jag\b|borde jag\b|förklara(?:\s|$)|berätta hur\b)/iu;
const IMPERATIVE = /^(?:(?:please|vänligen|kan du|could you|would you|jag vill att du|i want you to|i need you to)\s+)?(?:köra?|utföra?|göra?|öppna|navigera|klicka|skriva?|starta|posta|söka?|skapa|bygga?|fixa|ändra|uppdatera|run|execute|open|navigate|click|start|post|search|create|build|fix|change|update)(?=\s|[.,!?;:]|$)/iu;
export function shouldCreateChatMission(message) {
  if (message?.kind === 'mission' || message?.kind === 'coding-mission') return true;
  if (message?.kind && message.kind !== 'chat') return false;
  const text = String(message?.text || '').trim();
  if (!text || INFORMATIONAL.test(text)) return false;
  return IMPERATIVE.test(text);
}
