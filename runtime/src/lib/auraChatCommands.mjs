// Explicit operator actions in the conversation. Ordinary language is never
// interpreted by the model as permission to mutate a durable mission.
export function parseAuraMissionCommand(message = '') {
  const text = String(message).trim();
  if (/^(?:stoppa|avsluta) (?:det )?(?:pågående )?uppdraget[.!]?$/i.test(text) || /^stop (?:the )?(?:current )?mission[.!]?$/i.test(text)) return { kind:'stop' };
  const change = /^(?:(?:ändra|uppdatera|styr) (?:det )?(?:pågående )?uppdraget|(?:steer|update) (?:the )?(?:current )?mission):\s*([\s\S]+)$/i.exec(text);
  if (change && change[1].trim()) return { kind:'steer', instruction:change[1].trim().slice(0,2000) };
  return null;
}
