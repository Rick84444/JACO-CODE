import crypto from 'node:crypto';

































const emptyState = ()                    => ({
  schemaVersion: 1,
  intent: null,
  trackId: null,
  target: null,
  state: 'IDLE',
  app: null,
  expectedNextState: null,
  lastObservationAt: null,
  lastAction: null,
  wrongActionCount: 0,
  reidentificationCount: 0,
  events: [],
});

export class NovaTractionEngine {
          runtime = emptyState();

  getState()                    { return structuredClone(this.runtime); }

  beginIntent(intent        , expectedNextState                = null)                    {
    this.runtime = {
      ...emptyState(),
      intent,
      trackId: `TRACK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      state: 'ACQUIRING',
      expectedNextState,
      events: [{ at: new Date().toISOString(), type: 'intent.started', message: intent }],
    };
    return this.getState();
  }

  acquireTarget(target                                                                                                                                                                                 )                    {
    const confidence = Math.max(0, Math.min(1, Number(target.confidence ?? 0.5)));
    this.runtime = {
      ...this.runtime,
      target: {
        semanticPurpose: target.semanticPurpose,
        role: target.role,
        text: target.text,
        lastBbox: target.bbox,
        confidence,
        source: target.source ?? 'fusion',
      },
      state: confidence >= 0.7 ? 'LOCKED' : 'ACQUIRING',
      events: [...this.runtime.events, { at: new Date().toISOString(), type: 'target.acquired', message: `${target.semanticPurpose} confidence=${confidence.toFixed(2)}` }].slice(-200),
    };
    return this.getState();
  }

  observe(observation                 )                    {
    const at = observation.timestamp || new Date().toISOString();
    let next                    = { ...this.runtime, app: observation.app ?? this.runtime.app, lastObservationAt: at };
    if (observation.expectedTransitionObserved === true && next.state === 'VERIFYING') {
      next = { ...next, state: 'COMPLETE', target: next.target ? { ...next.target, confidence: 1 } : null };
      next.events = [...next.events, { at, type: 'transition.verified', message: next.expectedNextState || 'Expected UI transition verified' }].slice(-200);
      this.runtime = next;
      return this.getState();
    }

    if (next.target && Array.isArray(observation.semanticTargets)) {
      const purpose = next.target.semanticPurpose.toLowerCase();
      const text = (next.target.text || '').toLowerCase();
      const candidates = observation.semanticTargets
        .map(item => {
          const candidateText = String(item.text || '').toLowerCase();
          const semanticMatch = text && candidateText === text ? 1 : text && candidateText.includes(text) ? 0.85 : candidateText.includes(purpose.replaceAll('_', ' ')) ? 0.75 : 0;
          const roleMatch = next.target?.role && item.role === next.target.role ? 0.15 : 0;
          return { item, score: Math.min(1, semanticMatch + roleMatch + Number(item.confidence || 0) * 0.1) };
        })
        .sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best && best.score >= 0.7 && (!candidates[1] || best.score > candidates[1].score)) {
        const wasReid = ['OCCLUDED', 'OFFSCREEN', 'REIDENTIFYING', 'RECOVERING'].includes(next.state);
        next = {
          ...next,
          state: 'LOCKED',
          reidentificationCount: next.reidentificationCount + (wasReid ? 1 : 0),
          target: { ...next.target, text: best.item.text || next.target.text, role: best.item.role || next.target.role, lastBbox: best.item.bbox || next.target.lastBbox, confidence: best.score },
          events: [...next.events, { at, type: wasReid ? 'target.reidentified' : 'target.tracked', message: `${next.target.semanticPurpose} confidence=${best.score.toFixed(2)}` }].slice(-200),
        };
      } else {
        next = { ...next, state: 'REIDENTIFYING', target: { ...next.target, confidence: Math.max(0, next.target.confidence * 0.72) }, events: [...next.events, { at, type: 'target.lost', message: `Re-identifying ${next.target.semanticPurpose}` }].slice(-200) };
      }
    }
    this.runtime = next;
    return this.getState();
  }

  beforeAction(action        )                    {
    const age = Date.now() - Date.parse(this.runtime.lastObservationAt || '');
    if (!Number.isFinite(age) || age < 0 || age > 5000 || !this.runtime.target || this.runtime.target.confidence < 0.7 || this.runtime.state !== 'LOCKED') {
      this.runtime = { ...this.runtime, state: 'RECOVERING', lastAction: action, events: [...this.runtime.events, { at: new Date().toISOString(), type: 'action.blocked', message: `Blocked ${action}: target lock is not strong enough` }].slice(-200) };
      return this.getState();
    }
    this.runtime = { ...this.runtime, state: 'VERIFYING', lastAction: action, events: [...this.runtime.events, { at: new Date().toISOString(), type: 'action.started', message: action }].slice(-200) };
    return this.getState();
  }

  markActionFailure(reason        )                    {
    this.runtime = { ...this.runtime, state: 'RECOVERING', wrongActionCount: this.runtime.wrongActionCount + 1, events: [...this.runtime.events, { at: new Date().toISOString(), type: 'action.failed', message: reason }].slice(-200) };
    return this.getState();
  }
}

