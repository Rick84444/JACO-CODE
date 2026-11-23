// Pure projection of the canonical Nova mission and the existing UIA/relay
// actuator owners. It cannot pause or execute anything. The operator uses the
// existing authenticated pause/resume routes; this only verifies quiescence.
export function desktopTakeoverState(mission, {desktopBusy = false, relayLease = null} = {}) {
  const owned = mission?.metadata?.executor === 'desktop-agentos';
  if (!owned) return {ready:false, reason:'DESKTOP_MISSION_REQUIRED'};
  if (mission.status !== 'ACTIVE') return {ready:false, reason:'DESKTOP_MISSION_NOT_ACTIVE'};
  if (!mission.paused) return {ready:false, reason:'DESKTOP_MISSION_NOT_PAUSED'};
  // Pausing is cooperative: planning and running calls keep their Nova lease
  // until they finish. A token-free lease-presence observation is mandatory;
  // missing/unknown lease state fails closed. Never claim exclusive human control
  // from an ACK to pause.
  if (mission.executionLeaseActive !== false || mission.activeTask || mission.phase !== 'READY' || mission.cancelRequested ||
      desktopBusy === true || relayLease !== null) {
    return {ready:false, reason:'DESKTOP_ACTION_STILL_IN_FLIGHT'};
  }
  return {ready:true, reason:'JACO_DESKTOP_MISSION_QUIESCENT'};
}
