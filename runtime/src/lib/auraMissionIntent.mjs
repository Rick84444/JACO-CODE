// An explicit instruction in Full Autonomous is mission intent, not a request
// for another round of "shall I start?". Questions and ordinary chat stay chat.
const VERBS=/^(?:starta|utför|genomför|marknadsför|bygg|skapa|registrera|publicera|installera|undersök|granska|reparera|åtgärda|fixa|gör|koppla|anslut|optimera|lansera|start|execute|build|create|register|publish|install|investigate|inspect|repair|fix|connect|optimize|launch|promote)\b/i;
const PLEASE=/^(?:snälla|please)\s+/i;
export function isExplicitAutonomousMissionRequest(text) {
  if(typeof text!=='string')return false;
  const request=text.trim().replace(PLEASE,'');
  if(!request || request.endsWith('?') || request.length<8) return false;
  if(/^(?:hur|varför|vad|vilken|which|why|what|how|could|can)\b/i.test(request))return false;
  return VERBS.test(request);
}
