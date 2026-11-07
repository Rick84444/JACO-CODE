import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRoutineStore, nextRun, validateRoutine } from '../../runtime/src/server/connected/auraRoutines.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'routines-'));

test('a routine is validated: a real goal, named weekdays and a time of day', () => {
  assert.deepEqual(validateRoutine({ goal: 'Sök efter trender inom lokala AI-verktyg och skriv en kort sammanfattning.', days: ['Monday'], time: '08:00' }).days, ['mon']);
  assert.throws(() => validateRoutine({ goal: 'kort', days: ['mon'], time: '08:00' }), /ROUTINE_GOAL_INVALID/);
  assert.throws(() => validateRoutine({ goal: 'Sök efter trender varje vecka.', days: ['someday'], time: '08:00' }), /ROUTINE_DAYS_INVALID/);
  assert.throws(() => validateRoutine({ goal: 'Sök efter trender varje vecka.', days: ['mon'], time: '25:00' }), /ROUTINE_TIME_INVALID/);
});

test('the next run is the coming matching weekday and time', () => {
  const r = { days: ['mon'], time: '08:00' };
  const saturday = new Date(2026, 10, 7, 12, 0);
  const next = nextRun(r, saturday);
  assert.equal(next.getDay(), 1);
  assert.equal(next.getHours(), 8);
  assert.equal(next.getDate(), 9);
});

test('a due routine starts one ordinary mission, once per due time, and a failed start is recorded, not retried in a loop', async () => {
  const d = dir();
  try {
    let clock = new Date(2026, 10, 9, 7, 0);
    const store = createRoutineStore({ file: path.join(d, 'routines.json'), now: () => clock });
    store.add({ title: 'Veckans trender', goal: 'Sök efter trender inom lokala AI-verktyg och skriv en kort sammanfattning.', days: ['mon'], time: '08:00' });
    const goals = [];
    const startGoal = async goal => { goals.push(goal); return { id: `m${goals.length}` }; };
    assert.deepEqual((await store.tick({ startGoal })).started, [], 'not before its time');
    clock = new Date(2026, 10, 9, 8, 1);
    assert.equal((await store.tick({ startGoal })).started.length, 1);
    assert.match(goals[0], /^\[Routine: Veckans trender\] Sök efter trender/);
    clock = new Date(2026, 10, 9, 8, 5);
    assert.equal((await store.tick({ startGoal })).started.length, 0, 'only once for this Monday');
    clock = new Date(2026, 10, 16, 8, 2);
    let failures = 0;
    await store.tick({ startGoal: async () => { failures++; throw new Error('DAILY_BUDGET_LIMIT'); } });
    await store.tick({ startGoal: async () => { failures++; throw new Error('DAILY_BUDGET_LIMIT'); } });
    assert.equal(failures, 1, 'a failed start waits for the next due time');
    assert.equal(store.list()[0].lastError, 'DAILY_BUDGET_LIMIT');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a paused routine never starts, and routines can be removed', async () => {
  const d = dir();
  try {
    const clock = new Date(2026, 10, 9, 8, 1);
    const store = createRoutineStore({ file: path.join(d, 'routines.json'), now: () => clock });
    const r = store.add({ goal: 'Sök efter trender inom lokala AI-verktyg.', days: ['mon'], time: '08:00', enabled: false });
    assert.equal((await store.tick({ startGoal: async () => assert.fail('must not start') })).started.length, 0);
    assert.deepEqual(store.remove(r.id), { removed: r.id });
    assert.equal(store.list().length, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
