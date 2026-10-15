export { NovaTractionEngine } from './tractionCore.mjs';

export type NovaTrackState = 'IDLE' | 'ACQUIRING' | 'LOCKED' | 'OCCLUDED' | 'OFFSCREEN' | 'REIDENTIFYING' | 'VERIFYING' | 'RECOVERING' | 'COMPLETE';

export interface NovaObservation {
  timestamp?: string;
  app?: string;
  screen?: string;
  semanticTargets?: Array<{ id?: string; role?: string; text?: string; bbox?: [number, number, number, number]; confidence?: number }>;
  expectedTransitionObserved?: boolean;
}

export interface NovaTractionState {
  schemaVersion: 1;
  intent: string | null;
  trackId: string | null;
  target: {
    semanticPurpose: string;
    role?: string;
    text?: string;
    lastBbox?: [number, number, number, number];
    confidence: number;
    source: 'accessibility' | 'dom' | 'vision' | 'fusion';
  } | null;
  state: NovaTrackState;
  app: string | null;
  expectedNextState: string | null;
  lastObservationAt: string | null;
  lastAction: string | null;
  wrongActionCount: number;
  reidentificationCount: number;
  events: Array<{ at: string; type: string; message: string }>;
}

