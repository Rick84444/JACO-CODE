export type JobType =
  | 'code_refactor'
  | 'quality_audit'
  | 'git_ops'
  | 'npu_inference'
  | 'model_benchmark'
  | 'system_patch';

export type JobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export interface JobPolicyRequirement {
  requiresOperatorApproval: boolean;
  governanceCategory: 'security' | 'filesystem' | 'git' | 'runtime' | 'npu';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
}

export interface JobRecord<TPayload = any, TResult = any> {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number; // Högre nummer = högre prioritet (t.ex. 1-100)
  payload: TPayload;
  result?: TResult;
  error?: string;
  policy: JobPolicyRequirement;
  workerId?: string;
  retryCount: number;
  maxRetries: number;
  approvedBy?: string;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface EnqueueOptions<TPayload = any> {
  type: JobType;
  payload: TPayload;
  priority?: number;
  requiresApproval?: boolean;
  governanceCategory?: 'security' | 'filesystem' | 'git' | 'runtime' | 'npu';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description?: string;
  maxRetries?: number;
}
