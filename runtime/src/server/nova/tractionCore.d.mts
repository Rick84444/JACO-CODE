import type {NovaObservation, NovaTractionState, ManifoldDrift} from './traction';
export class DomTractionEngine {
  getState(): NovaTractionState;
  beginIntent(intent: string, expectedNextState?: string | null): NovaTractionState;
  acquireTarget(target: {semanticPurpose: string; role?: string; text?: string; bbox?: [number,number,number,number]; confidence?: number; source?: 'accessibility'|'dom'|'vision'|'fusion'}): NovaTractionState;
  observe(observation: NovaObservation): NovaTractionState;
  beforeAction(action: string): NovaTractionState;
  markActionFailure(reason: string): NovaTractionState;
}

export { DomTractionEngine as TargetTractionEngine };
export { DomTractionEngine as NovaTractionEngine };

export const DRIFT_THRESHOLD: number;
export function computeManifoldDrift(previous: {role?:string;text?:string;bbox?:number[];lastBbox?:number[];confidence?:number}, current:{role?:string;text?:string;bbox?:number[];lastBbox?:number[]},dt:number):ManifoldDrift;
