// Routines: goals the operator has approved to run again on a schedule ("every Monday at 08:00, look for trends and
// write a short summary"). A routine only ever starts an ordinary mission through the same start-goal path as the
// chat, so budget, approvals, the sandbox and every other rule still apply to each run. Nothing here grants authority.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_ROUTINES = 20;

export function validateRoutine(input = {}) {
  const goal = String(input.goal || '').trim();
  if (goal.length < 10 || goal.length > 4000) throw new Error('ROUTINE_GOAL_INVALID');
  const title = String(input.title || goal.slice(0, 60)).trim().slice(0, 120);
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(d => String(d).toLowerCase().slice(0, 3)))];
  if (!days.length || days.some(d => !DAYS.includes(d))) throw new Error('ROUTINE_DAYS_INVALID');
  const time = String(input.time || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('ROUTINE_TIME_INVALID');
  return { title, goal, days, time, enabled: input.enabled !== false };
}

// The next local time at or after `from` that matches the routine's days and time.
export function nextRun(routine, from = new Date()) {
  const [h, m] = routine.time.split(':').map(Number);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, h, m, 0, 0);
    if (d >= from && routine.days.includes(DAYS[d.getDay()])) return d;
  }
  return null;
}

export function createRoutineStore({ file, now = () => new Date() }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { routines: [] }; } };
  const write = state => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n'); fs.renameSync(tmp, file); };
  return {
    list() { return read().routines.map(r => ({ ...r, nextRunAt: r.enabled ? nextRun(r, now())?.toISOString() ?? null : null })); },
    add(input) {
      const state = read();
      if (state.routines.length >= MAX_ROUTINES) throw new Error('ROUTINE_LIMIT_REACHED');
      const routine = { id: `routine-${crypto.randomBytes(4).toString('hex')}`, ...validateRoutine(input), createdAt: now().toISOString(), lastRunAt: null, lastMissionId: null, lastError: null };
      state.routines.push(routine); write(state); return routine;
    },
    update(id, patch = {}) {
      const state = read();
      const i = state.routines.findIndex(r => r.id === id);
      if (i < 0) throw new Error('ROUTINE_NOT_FOUND');
      state.routines[i] = { ...state.routines[i], ...validateRoutine({ ...state.routines[i], ...patch }) };
      write(state); return state.routines[i];
    },
    remove(id) {
      const state = read();
      const before = state.routines.length;
      state.routines = state.routines.filter(r => r.id !== id);
      if (state.routines.length === before) throw new Error('ROUTINE_NOT_FOUND');
      write(state); return { removed: id };
    },
    // Starts every routine whose time has come since its last run, at most once per due time. A start that fails is
    // recorded and not retried until the next due time, so a broken routine cannot loop and spend.
    async tick({ startGoal }) {
      const state = read();
      const started = [];
      const at = now();
      for (const r of state.routines) {
        if (!r.enabled) continue;
        const since = new Date(r.lastRunAt ? Date.parse(r.lastRunAt) + 60_000 : Date.parse(r.createdAt));
        const due = nextRun(r, since);
        if (!due || due > at) continue;
        r.lastRunAt = at.toISOString();
        try {
          const mission = await startGoal(`[Routine: ${r.title}] ${r.goal}`);
          r.lastMissionId = mission?.id || null; r.lastError = null;
          started.push({ id: r.id, missionId: r.lastMissionId });
        } catch (error) { r.lastError = String(error?.message || error).slice(0, 300); }
      }
      if (started.length || state.routines.some(r => r.lastError)) write(state);
      return { started };
    },
  };
}
