// Operator-only presentation of JACO's existing Laser Vision mission screenshot.
// No new screen capture, agent, memory, input transport, or network permissions.
// The canonical mission receipt must attest the exact PNG bytes, and an
// authorized desktop operator must explicitly enable remote screen viewing.
import { freshMissionFrame } from './mission-screen-frame.mjs';

export function readAuraDesktopLiveFrame({mission, file, env = process.env, now = Date.now(), read, stat} = {}) {
  if (env.JACO_AURA_DESKTOP_SCREEN_VIEW !== '1') {
    return { ok:false, reason:'DESKTOP_SCREEN_VIEW_NOT_ENABLED' };
  }
  if (!mission || mission.status !== 'ACTIVE' || (mission.metadata?.executor ?? mission.executor) !== 'desktop-agentos') {
    return { ok:false, reason:'NO_ACTIVE_DESKTOP_MISSION' };
  }
  const options = { now, maxAgeMs:12000, ...(read ? {read} : {}), ...(stat ? {stat} : {}) };
  const frame = freshMissionFrame(mission, file, options);
  if (!frame) return { ok:false, reason:'NO_FRESH_VERIFIED_LASER_VISION_FRAME' };
  if (!Number.isSafeInteger(frame.sessionId) || frame.sessionId <= 0) return {ok:false,reason:'DESKTOP_FRAME_SESSION_UNVERIFIED'};
  if (!frame.url.startsWith('data:image/png;base64,')) return { ok:false, reason:'DESKTOP_FRAME_INVALID' };
  return {
    ok:true, png:Buffer.from(frame.url.slice('data:image/png;base64,'.length), 'base64'),
    at:frame.at, sha256:frame.sha256, missionId:mission.id, sessionId:frame.sessionId,
  };
}
