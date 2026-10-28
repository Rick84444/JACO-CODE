/** Bounded progress policy: an executed test is not by itself progress. */
export class CognitiveProgressGovernor {
  #seen = new Map();
  #best = -1;
  #steps = 0;
  #stalled = 0;
  constructor({maxSteps = 8, maxStalls = 2} = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || !Number.isSafeInteger(maxStalls) || maxStalls < 0)
      throw new Error('PROGRESS_POLICY_INVALID');
    this.maxSteps = maxSteps;
    this.maxStalls = maxStalls;
  }
  before(signature) {
    if (++this.#steps > this.maxSteps) throw new Error('PROGRESS_STEP_BUDGET_EXHAUSTED');
    if (this.#seen.has(signature)) throw new Error('PROGRESS_REPEAT_WITHOUT_MUTATION');
  }
  observe(signature, {passed, total, codeHash}) {
    if (!Number.isSafeInteger(passed) || !Number.isSafeInteger(total) || total < 1 || passed < 0 || passed > total ||
        !/^[a-f0-9]{64}$/.test(codeHash)) throw new Error('PROGRESS_RESULT_INVALID');
    if (this.#seen.has(signature)) throw new Error('PROGRESS_REPEAT_WITHOUT_MUTATION');
    this.#seen.set(signature, {passed, codeHash});
    const improved = passed > this.#best;
    if (improved) {this.#best = passed; this.#stalled = 0;}
    else if (++this.#stalled > this.maxStalls) throw new Error('PROGRESS_NO_IMPROVEMENT');
    return {improved, passed, total, bestPassed: this.#best, stalledSteps: this.#stalled, remainingSteps: this.maxSteps - this.#steps};
  }
}
