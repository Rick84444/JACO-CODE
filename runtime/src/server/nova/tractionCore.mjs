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
  drift: null,
  lastAction: null,
  wrongActionCount: 0,
  reidentificationCount: 0,
  events: [],
});

// A bounded heuristic, not a calibrated probability. Missing geometry stays unknown.
export const DRIFT_THRESHOLD=0.35;
const HALF_LIFE_MS=2500;
const normalized=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
function centroid(b){
  if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[2]<=0||b[3]<=0)return null;
  const [x,y,w,h]=b;return {x:x+w/2,y:y+h/2,w,h,diag:Math.hypot(w,h)};
}
export function computeManifoldDrift(prev,next,dt){
  const semanticMismatch=Number(Boolean((normalized(prev?.role)&&normalized(prev.role)!==normalized(next?.role))||(normalized(prev?.text)&&normalized(prev.text)!==normalized(next?.text))));
  const a=centroid(prev?.lastBbox??prev?.bbox),b=centroid(next?.bbox??next?.lastBbox);
  const geomDrift=a&&b?Math.min(1,Math.max(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(a.diag,32),Math.abs(Math.log(b.w/a.w)),Math.abs(Math.log(b.h/a.h)))):null;
  const validTime=Number.isFinite(dt)&&dt>=0;
  const timeDecay=validTime?1-Math.exp(-Math.LN2*dt/HALF_LIFE_MS):1;
  const g=geomDrift??0;
  const drift=semanticMismatch||!validTime?1:g+timeDecay-g*timeDecay;
  const c=Number(prev?.confidence??0);
  return {drift,semanticMismatch,geomDrift,timeDecay,decayedConfidence:Number.isFinite(c)?Math.max(0,Math.min(1,c))*(1-drift):0,geometryObserved:geomDrift!==null,lockBroken:drift>DRIFT_THRESHOLD};
}

export class DomTractionEngine {
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
    const supplied=Number(target.confidence ?? 0.5);
    const confidence = Number.isFinite(supplied)?Math.max(0,Math.min(1,supplied)):0;
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
    const age=Date.now()-Date.parse(at);
    if(!Number.isFinite(age)||age<0||age>5000|| (this.runtime.app&&observation.app&&observation.app!==this.runtime.app)) {
      this.runtime={...next,state:'REIDENTIFYING',target:next.target?{...next.target,confidence:0}:null};
      return this.getState();
    }
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
          return { item, score: Math.min(1, semanticMatch + roleMatch + (Number.isFinite(Number(item.confidence))?Math.max(0,Math.min(1,Number(item.confidence))):0) * 0.1) };
        })
        .sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best && best.score >= 0.7 && (!candidates[1] || best.score > candidates[1].score)) {
        const wasReid = ['OCCLUDED', 'OFFSCREEN', 'REIDENTIFYING', 'RECOVERING'].includes(next.state);
        const dt=this.runtime.lastObservationAt?Date.parse(at)-Date.parse(this.runtime.lastObservationAt):0;
        const metrics=computeManifoldDrift(next.target,best.item,dt);
        next.drift=metrics;
        // After losing a lock, require explicit fresh acquisition; never silently
        // switch the locked identity or baseline to a different object.
        if(metrics.lockBroken){
          this.runtime={...next,state:'REIDENTIFYING',target:{...next.target,confidence:metrics.decayedConfidence},events:[...next.events,{at,type:'manifold.drift_abort',message:'Target identity or continuity lost'}].slice(-200)};
          return this.getState();
        }
        next = {
          ...next,
          state: 'LOCKED',
          reidentificationCount: next.reidentificationCount + (wasReid ? 1 : 0),
          target: { ...next.target, text: best.item.text || next.target.text, role: best.item.role || next.target.role, lastBbox: best.item.bbox || next.target.lastBbox, confidence: best.score*(1-metrics.drift) },
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
    if (!Number.isFinite(age) || age < 0 || age > 5000 || 1-Math.exp(-Math.LN2*age/HALF_LIFE_MS)>DRIFT_THRESHOLD || !this.runtime.target || this.runtime.target.confidence < 0.7 || this.runtime.state !== 'LOCKED') {
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


// Backward-compatible export for existing Android traction routes and consumers.
export { DomTractionEngine as NovaTractionEngine };
