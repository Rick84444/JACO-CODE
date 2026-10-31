// Notices when an agent is going in circles, from what it did, not from what it says (idea from OpenHands'
// stuck detection). Three patterns over the most recent steps:
//   repeat      the same tool with the same arguments gave the same result 3 times in a row
//   error-loop  4 steps in a row failed with the same error, whatever they were called with
//   ping-pong   two different steps alternating A,B,A,B,A,B with identical results
//   recurring   the same call made 4 times in the window, interleaved with other steps, whatever it returned
//   poll-limit  the same call 8 times in the window even back to back, whatever it returned
// The loop nudges the model once with a hint; if the next window is stuck again it stops and says so.
import crypto from 'node:crypto';

// Key order does not make a different call: a planner sent {command,args} and {args,command} alternately.
const stable = value => JSON.stringify(value ?? null, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => crypto.createHash('sha1').update(typeof value === 'string' ? value : stable(value)).digest('hex').slice(0, 16);

export class StuckDetector {
  constructor({ repeat = 3, errorRun = 4, pingPong = 6, recurring = 4, pollLimit = 8 } = {}) {
    this.limits = { repeat, errorRun, pingPong, recurring, pollLimit };
    this.steps = [];
    this.nudges = 0;
  }

  // name: the tool; args/result: JSON-like; ok: whether the step worked; error: the failure text, if any.
  record({ name, args, ok, result, error }) {
    this.steps.push({
      name: String(name),
      call: `${name}:${digest(args)}`,
      outcome: digest(ok === false ? String(error || result?.error || 'failed') : result),
      ok: ok !== false,
      error: ok === false ? String(error || result?.error || 'failed').slice(0, 200) : '',
    });
    if (this.steps.length > 24) this.steps.shift();
  }

  check() {
    const s = this.steps, { repeat, errorRun, pingPong, recurring, pollLimit } = this.limits;
    const tail = n => s.slice(-n);
    if (s.length >= repeat) {
      const t = tail(repeat);
      if (t.every(x => x.call === t[0].call && x.outcome === t[0].outcome)) {
        return { stuck: true, kind: 'repeat', hint: `You called ${t[0].name} with the same arguments ${repeat} times and got the same result each time. Repeating it will not change anything: use a different tool, different arguments, or call blocked and say what is missing.` };
      }
    }
    if (s.length >= errorRun) {
      const t = tail(errorRun);
      if (t.every(x => !x.ok && x.error && x.error === t[0].error)) {
        return { stuck: true, kind: 'error-loop', hint: `The last ${errorRun} steps all failed with the same error (${t[0].error.slice(0, 120)}). Stop retrying variations of the same thing: read the error, change the approach, or call blocked and explain.` };
      }
    }
    if (s.length >= pingPong) {
      const t = tail(pingPong);
      const a = t[0], b = t[1];
      const alternates = a.call !== b.call && t.every((x, i) => x.call === (i % 2 ? b.call : a.call) && x.outcome === (i % 2 ? b.outcome : a.outcome));
      if (alternates) return { stuck: true, kind: 'ping-pong', hint: `You are alternating between ${a.name} and ${b.name} and getting the same results every time. Neither step moves the goal forward: decide what is missing and do something else, or call blocked.` };
    }
    // A cycle of three or more steps (a rejected shell read, then two status reads, again and again: 23 paid
    // turns on 2026-10-31) escapes the patterns above, and status results differ by their timestamps.
    // Back-to-back calls are a poll and stay allowed up to pollLimit (a status read whose timestamp changes
    // each time looked like progress 40 times in a row, 2026-10-31); a call that keeps coming back between
    // other steps counts from the recurring limit.
    const last = s.at(-1);
    const at = last ? s.flatMap((x, i) => x.call === last.call ? [i] : []) : [];
    const interleaved = at.length >= recurring && at.at(-1) - at[0] + 1 > at.length;
    if (interleaved || at.length >= pollLimit) {
      return { stuck: true, kind: interleaved ? 'recurring' : 'poll-limit', hint: `You have called ${last.name} with the same arguments ${at.length} times in this run. ${last.ok ? 'You already have its result: use it' : `It keeps failing (${last.error.slice(0, 120)}): it will not work`}. Complete the step with the evidence you have, do something different, or call blocked and say what you are waiting for.` };
    }
    return { stuck: false };
  }

  // After a nudge the window starts fresh, so the model gets a real chance to change course.
  nudge() { this.nudges++; this.steps = []; return this.nudges; }
}
