// A read-only projection of already redacted runtime observations. No execution or invented output.
export function projectAuraTerminal(events = [], missionId = null, limit = 12) {
  const actions = new Map();
  for (const event of [...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at) || (a.seq||0)-(b.seq||0))) {
    if (!event.terminal || !event.actionId || (missionId && event.missionId !== missionId)) continue;
    const key = JSON.stringify([event.missionId, event.actionId]);
    const old = actions.get(key);
    // Durable receipts outrank volatile copies, and a late start must not erase completed output.
    if (old?.done && event.terminal.phase !== 'finished') continue;
    if (old?.durable && !event.durable && event.terminal.phase === 'finished') continue;
    const terminal = event.terminal;
    actions.set(key, {id:key,actionId:event.actionId,at:event.at,
      command:terminal.command || old?.command || '',
      stdout:terminal.stdout ?? old?.stdout ?? '',stderr:terminal.stderr ?? old?.stderr ?? '',
      exitCode:terminal.exitCode ?? old?.exitCode ?? null,truncated:terminal.truncated === true,
      done:terminal.phase === 'finished',durable:event.durable === true,
      outcome:event.evidence?.outcome || 'observed'});
  }
  return [...actions.values()].slice(-limit);
}
