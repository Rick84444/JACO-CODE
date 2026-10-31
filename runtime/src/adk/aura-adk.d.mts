/** JACO Native ADK v1 — typed, local-only, policy-bound Aura client. */
export type AuraExecution = { readonly type: 'goal' } | { readonly type: 'skill'; readonly skillId: string };
export type AuraReadTool = { readonly providerId: string; readonly toolName: string };
export interface AuraProgramInput {
  id: string;
  version: string;
  description: string;
  execution: AuraExecution;
  readTools?: readonly AuraReadTool[];
}
export interface AuraProgram {
  readonly schema: 'jaco.adk.program/v1';
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly execution: Readonly<AuraExecution>;
  readonly readTools: readonly (AuraReadTool & {readonly mode:'read'})[];
  readonly operatorIdentity: 'aura';
}
export interface AuraDispatch {
  readonly schema: 'jaco.adk.dispatch/v1';
  readonly kind: 'seer-goal' | 'nova-mission';
  readonly id: string;
  readonly programId: string;
  readonly state: 'SUBMITTED';
  readonly executionVerified: false;
}
export interface AuraMissionObservation {
  schema: 'jaco.adk.mission-observation/v1';
  id: string;
  status: string;
  phase: string | null;
  observedAt: string;
  receiptCount: number | null;
  verifiedSteps: number | null;
  uncertainOutcomes: number | null;
  machineVerified: boolean;
  completionClaimed: boolean;
  accepted: false;
  terminal: boolean;
}
export interface AuraRuntimeObservation {
  schema: 'jaco.adk.runtime/v1';
  operator: 'aura';
  observedAt: string;
  sources: { workplace: boolean; missions: boolean };
  runtimeConsolidated: false;
  functions: Array<{id:string;state:string}>;
  oversight: Record<string, unknown>;
}
export interface AuraAdkEvent {
  readonly schema: 'jaco.adk.event/v1';
  readonly type: string;
  readonly at: string;
  readonly [name: string]: unknown;
}
export interface AuraApiClient {
  endpoint?: string;
  request(path:string, options?: {
    method?:string; body?:unknown; signal?:AbortSignal;
  }): Promise<unknown>;
  tools?: { list():Promise<unknown> };
}
export interface AuraAdkOptions {
  client?: AuraApiClient;
  endpoint?: string;
  token?: string;
  onEvent?: (event:AuraAdkEvent)=>void;
  maxObservationAgeMs?: number;
}
export class AuraAdkError extends Error {
  readonly code:string;
  readonly outcomeUnknown:boolean;
  constructor(code:string, message?:string, options?:{outcomeUnknown?:boolean;cause?:unknown});
}
export const JACO_ADK_VERSION: '1.0.0';
export function defineAuraProgram(spec:AuraProgramInput): AuraProgram;
export class AuraAdk {
  constructor(options?:AuraAdkOptions);
  inspect(options?:{signal?:AbortSignal}):Promise<AuraRuntimeObservation>;
  dispatch(program:AuraProgram, options:{
    goal?:string; input?:string; testCommands?:readonly string[];
    operatorAuthorized:boolean; signal?:AbortSignal;
  }):Promise<AuraDispatch>;
  mission(id:string, options?:{signal?:AbortSignal}):Promise<AuraMissionObservation>;
  awaitMission(id:string, options?:{
    intervalMs?:number; timeoutMs?:number;signal?:AbortSignal;
  }):Promise<AuraMissionObservation>;
  reviewMission(id:string, options?:{signal?:AbortSignal}):Promise<unknown>;
  cancelMission(id:string, options:{
    operatorAuthorized:boolean;signal?:AbortSignal;
  }):Promise<{id:string;requested:true;server:unknown}>;
  readTool(program:AuraProgram, options:{
    providerId:string;toolName:string;args?:Record<string,unknown>;signal?:AbortSignal;
  }):Promise<unknown>;
}
export function createAuraAdk(options?:AuraAdkOptions):AuraAdk;
