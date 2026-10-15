import crypto from 'crypto';
import { JacoLMStudioEvent, JacoLMStudioEventType, EvidenceLevel } from './schemas';
import { LMStudioPolicyGate } from './LMStudioPolicyGate';
import { lmStudioThreadStore } from './LMStudioThreadStore';

export class LMStudioEventMapper {
  public static createEvent(params: {
    missionId: string;
    threadId?: string;
    type: JacoLMStudioEventType;
    status: 'REAL' | 'BLOCKED' | 'FAILED';
    summary: string;
    evidence?: unknown;
    evidenceLevel?: EvidenceLevel;
  }): JacoLMStudioEvent {
    const maskedSummary = LMStudioPolicyGate.maskSecrets(params.summary);

    let sanitizedEvidence = params.evidence;
    if (typeof sanitizedEvidence === 'string') {
      sanitizedEvidence = LMStudioPolicyGate.maskSecrets(sanitizedEvidence);
    } else if (sanitizedEvidence && typeof sanitizedEvidence === 'object') {
      try {
        const jsonStr = JSON.stringify(sanitizedEvidence);
        sanitizedEvidence = JSON.parse(LMStudioPolicyGate.maskSecrets(jsonStr));
      } catch {}
    }

    let finalStatus = params.status;
    if (params.evidenceLevel === 'BLOCKED') {
      finalStatus = 'BLOCKED';
    }

    return {
      eventId: `lm_evt_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
      missionId: params.missionId,
      threadId: params.threadId,
      type: params.type,
      status: finalStatus,
      summary: maskedSummary,
      evidence: sanitizedEvidence
        ? {
            level: params.evidenceLevel || (params.status === 'REAL' ? 'VERIFIED' : 'REPORTED'),
            data: sanitizedEvidence
          }
        : undefined
    };
  }

  public static mapAndEmit(
    rawOrParams: any,
    missionId: string,
    threadId?: string,
    onEvent?: (evt: JacoLMStudioEvent) => void
  ): JacoLMStudioEvent {
    let normalizedEvent: JacoLMStudioEvent;

    if (rawOrParams && rawOrParams.type && rawOrParams.summary && rawOrParams.missionId) {
      normalizedEvent = this.createEvent(rawOrParams);
    } else {
      normalizedEvent = this.createEvent({
        missionId,
        threadId,
        type: rawOrParams.type || 'analysis.progress',
        status: rawOrParams.status || 'REAL',
        summary: rawOrParams.summary || rawOrParams.message || 'LM Studio event received',
        evidence: rawOrParams,
        evidenceLevel: 'VERIFIED'
      });
    }

    lmStudioThreadStore.emitEvent(normalizedEvent);

    if (onEvent) {
      try {
        onEvent(normalizedEvent);
      } catch (err) {
        console.error('[LMStudioEventMapper] Error calling onEvent callback:', err);
      }
    }

    return normalizedEvent;
  }
}
