import type {NovaObservation, NovaTractionState} from './traction';
export class NovaTractionEngine {
  getState(): NovaTractionState;
  beginIntent(intent: string, expectedNextState?: string | null): NovaTractionState;
  acquireTarget(target: {semanticPurpose: string; role?: string; text?: string; bbox?: [number,number,number,number]; confidence?: number; source?: 'accessibility'|'dom'|'vision'|'fusion'}): NovaTractionState;
  observe(observation: NovaObservation): NovaTractionState;
  beforeAction(action: string): NovaTractionState;
  markActionFailure(reason: string): NovaTractionState;
}
