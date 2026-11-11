// Mission cards are a read-only projection of the same observed mission used by AuraPresence.
// A durable ACTIVE flag alone never proves that an executor is doing work.
export function missionCardState(mission, presence) {
  if (!mission?.id) return 'unknown';
  if (mission.cancelRequested) return 'stopping';
  const status = String(mission.status || '').toUpperCase();
  if (status === 'BLOCKED') return 'blocked';
  if (status === 'AWAITING_VERIFICATION') return 'verifying';
  if (status !== 'ACTIVE') return 'unconfirmed';

  // The card must not use another mission's presence or a stale connection to claim activity.
  if (!presence || String(presence.missionId || '') !== String(mission.id)) return 'unconfirmed';
  if (['offline', 'reconnecting', 'connecting'].includes(presence.mode)) return 'unknown';
  if (presence.mode === 'stalled') return 'stalled';
  if (presence.mode === 'blocked') return 'blocked';
  if (presence.mode === 'queued') return 'queued';
  if (presence.mode === 'working') return 'working';
  return 'unconfirmed';
}
