import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  LMStudioMissionContract,
  LMStudioVerificationResult,
  LMStudioModelInfo,
  JacoLMStudioEvent
} from './schemas';
import { LMStudioPolicyGate } from './LMStudioPolicyGate';
import { LMStudioEventMapper } from './LMStudioEventMapper';
import { lmStudioThreadStore } from './LMStudioThreadStore';

const execAsync = promisify(exec);

export class LMStudioRuntimeAdapter {
  private activeMissions: Map<string, { cancelled: boolean }> = new Map();

  /**
   * Verifies connection to LM Studio instance and returns host status, latency, and available models.
   */
  public async verifyIntegration(
    hostUrlOverride?: string,
    workspacePathOverride?: string
  ): Promise<LMStudioVerificationResult> {
    const manifest = lmStudioThreadStore.getManifest();
    let hostUrl = hostUrlOverride || manifest.hostUrl || 'http://127.0.0.1:1234/v1';
    
    // Ensure hostUrl ends without trailing slash if needed, or format properly
    if (!hostUrl.startsWith('http://') && !hostUrl.startsWith('https://')) {
      hostUrl = `http://${hostUrl}`;
    }
    const cleanHost = hostUrl.endsWith('/v1') ? hostUrl : `${hostUrl.replace(/\/$/, '')}/v1`;

    const targetWorkspace = workspacePathOverride || process.cwd();
    const canonical = LMStudioPolicyGate.resolveCanonicalPath(targetWorkspace, '');

    const details: string[] = [];
    let hostReachable = false;
    let latencyMs: number | undefined = undefined;
    let availableModels: LMStudioModelInfo[] = [];

    const startTime = Date.now();
    try {
      const response = await fetch(`${cleanHost}/models`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      latencyMs = Date.now() - startTime;

      if (response.ok) {
        hostReachable = true;
        const data: any = await response.json();
        if (data && Array.isArray(data.data)) {
          availableModels = data.data.map((m: any) => ({
            id: m.id,
            object: m.object || 'model',
            owned_by: m.owned_by || 'lmstudio'
          }));
          details.push(`LM Studio ansluten på ${cleanHost}. Hittade ${availableModels.length} inladdade/tillgängliga modeller.`);
        } else {
          details.push(`LM Studio Svarade OK på ${cleanHost}, men returnerade inga modeller ännu.`);
        }
      } else {
        details.push(`LM Studio returnerade HTTP ${response.status} på ${cleanHost}/models.`);
      }
    } catch (err: any) {
      details.push(`Kunde inte nå LM Studio på ${cleanHost}: ${err?.message || err}`);
    }

    if (canonical.valid) {
      details.push(`Kanonisk workspace-sökväg verifierad: ${canonical.canonicalWorkspace}`);
    } else {
      details.push(`Workspace-fel: ${canonical.error}`);
    }

    let status: LMStudioVerificationResult['status'] = 'unavailable';
    if (hostReachable && canonical.valid) {
      status = manifest.enabled ? 'enabled' : 'connected';
    } else if (hostReachable) {
      status = 'degraded';
    }

    return {
      timestamp: new Date().toISOString(),
      hostUrl: cleanHost,
      hostReachable,
      latencyMs,
      availableModels,
      workspaceValid: canonical.valid,
      workspacePath: targetWorkspace,
      canonicalWorkspacePath: canonical.canonicalWorkspace,
      status,
      details,
      evidenceLevel: hostReachable ? 'VERIFIED' : 'REPORTED'
    };
  }

  /**
   * Executes a mission using LM Studio as the local LLM inference engine.
   */
  public async executeMission(
    contract: LMStudioMissionContract,
    onEvent?: (evt: JacoLMStudioEvent) => void
  ): Promise<{ success: boolean; output: string; patchProposed?: string }> {
    const missionId = contract.missionId;
    const threadId = contract.threadId || `thread_${Date.now()}`;
    this.activeMissions.set(missionId, { cancelled: false });

    LMStudioEventMapper.mapAndEmit(
      {
        missionId,
        threadId,
        type: 'mission.started',
        status: 'REAL',
        summary: `LM Studio Mission startad: "${contract.objective}"`,
        evidence: contract,
        evidenceLevel: 'VERIFIED'
      },
      missionId,
      threadId,
      onEvent
    );

    const manifest = lmStudioThreadStore.getManifest();
    const validation = LMStudioPolicyGate.validateMissionContract(contract, manifest.enabled);
    if (!validation.valid) {
      const errMsg = validation.errors.map((e) => e.message).join('; ');
      LMStudioEventMapper.mapAndEmit(
        {
          missionId,
          threadId,
          type: 'mission.failed',
          status: 'BLOCKED',
          summary: `Safety Gate blockerad: ${errMsg}`,
          evidence: validation.errors,
          evidenceLevel: 'BLOCKED'
        },
        missionId,
        threadId,
        onEvent
      );
      this.activeMissions.delete(missionId);
      return { success: false, output: errMsg };
    }

    // Verify host
    const hostUrl = contract.hostUrl || manifest.hostUrl || 'http://127.0.0.1:1234/v1';
    const cleanHost = hostUrl.endsWith('/v1') ? hostUrl : `${hostUrl.replace(/\/$/, '')}/v1`;

    try {
      // Step 1: Read target files context if specified
      let contextFilesText = '';
      if (contract.targetFiles && contract.targetFiles.length > 0) {
        for (const fileRel of contract.targetFiles) {
          const resolved = LMStudioPolicyGate.resolveCanonicalPath(contract.workspacePath, fileRel);
          if (resolved.valid && fs.existsSync(resolved.canonicalPath)) {
            const content = fs.readFileSync(resolved.canonicalPath, 'utf-8');
            contextFilesText += `\n--- FILE: ${fileRel} ---\n${content.slice(0, 8000)}\n`;
          }
        }
      }

      LMStudioEventMapper.mapAndEmit(
        {
          missionId,
          threadId,
          type: 'analysis.progress',
          status: 'REAL',
          summary: `Skickar förfrågan till lokal LM Studio-modell på ${cleanHost}...`,
          evidence: { hostUrl: cleanHost, targetFiles: contract.targetFiles },
          evidenceLevel: 'VERIFIED'
        },
        missionId,
        threadId,
        onEvent
      );

      // System Prompt & User Prompt for LM Studio
      const systemPrompt = `Du är JACO LM Studio Runtime Agent, en autonom lokal kodnings- och refaktoreringsagent.
Din uppgift: Utför följande uppdrag på källkoden.
Läge: ${contract.mode}
Tillåtna kommandon: ${contract.allowedCommands.join(', ')}

Du svarar med strukturerad analys, kodbeskrivning och eventuella patch-förslag i ett format med tydliga kodblock. Om du föreslår ändringar i en fil, inkludera en komplett kodrevidering eller en Unified Diff i ett kodblock markerat med \`\`\`diff eller \`\`\`typescript.`;

      const userPrompt = contract.prompt || `Uppdrag: ${contract.objective}

Sammanhang/filer:
${contextFilesText || 'Inga specifika filer valda. Analysera generellt.'}`;

      const modelId = contract.modelId || manifest.selectedModel || 'local-model';

      // Call LM Studio OpenAI compatible endpoint
      const response = await fetch(`${cleanHost}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer lm-studio'
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(contract.timeoutMs || 45000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LM Studio HTTP ${response.status}: ${errorText}`);
      }

      const responseData: any = await response.json();
      const modelChoice = responseData.choices?.[0]?.message?.content || 'Inget svar genererades av LM Studio.';

      LMStudioEventMapper.mapAndEmit(
        {
          missionId,
          threadId,
          type: 'model.response',
          status: 'REAL',
          summary: `Mottog svar från LM Studio (${modelId})`,
          evidence: { rawLength: modelChoice.length, model: modelId },
          evidenceLevel: 'VERIFIED'
        },
        missionId,
        threadId,
        onEvent
      );

      // Check if patch suggested
      let patchProposed: string | undefined = undefined;
      if (contract.suggestedPatch) {
        patchProposed = contract.suggestedPatch;
      } else if (modelChoice.includes('```diff') || modelChoice.includes('```typescript')) {
        const diffMatch = modelChoice.match(/```(?:diff|typescript|ts|tsx)?\n([\s\S]*?)\n```/);
        if (diffMatch && diffMatch[1]) {
          patchProposed = diffMatch[1];
        }
      }

      if (patchProposed) {
        LMStudioEventMapper.mapAndEmit(
          {
            missionId,
            threadId,
            type: 'patch.proposed',
            status: 'REAL',
            summary: `LM Studio genererade ett patch-förslag.`,
            evidence: { patch: patchProposed, targetFiles: contract.targetFiles },
            evidenceLevel: 'VERIFIED'
          },
          missionId,
          threadId,
          onEvent
        );
      }

      // Check for approval policy
      const approvalRule = LMStudioPolicyGate.requiresOperatorApproval(
        contract.mode,
        patchProposed ? 'patch.apply' : 'analysis.read',
        contract.targetFiles || ['src/']
      );

      if (approvalRule.approvalNeeded && patchProposed) {
        const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const actionPayload = { patch: patchProposed, targetFiles: contract.targetFiles };
        const actionHash = LMStudioPolicyGate.computeActionHash(missionId, actionId, actionPayload);

        lmStudioThreadStore.addPendingApproval({
          actionId,
          missionId,
          actionType: 'patch.apply',
          description: `Tillämpa LM Studio patch på ${contract.targetFiles?.join(', ') || 'workspace'}`,
          targetFiles: contract.targetFiles || [],
          riskClass: approvalRule.riskClass,
          expectedConsequence: 'Uppdaterar källkodsfiler med den lokalt genererade patchen.',
          rollbackPlan: 'Git checkout eller återställning via JACO backup.',
          actionHash,
          status: 'pending',
          createdAt: new Date().toISOString(),
          actionPayload
        });

        LMStudioEventMapper.mapAndEmit(
          {
            missionId,
            threadId,
            type: 'approval.required',
            status: 'REAL',
            summary: `Operatörsgodkännande krävs (${approvalRule.riskClass}): ${approvalRule.reason}`,
            evidence: { actionId, actionHash, riskClass: approvalRule.riskClass },
            evidenceLevel: 'VERIFIED'
          },
          missionId,
          threadId,
          onEvent
        );
      }

      LMStudioEventMapper.mapAndEmit(
        {
          missionId,
          threadId,
          type: 'mission.completed',
          status: 'REAL',
          summary: `LM Studio uppdrag fullföljt framgångsrikt.`,
          evidence: { modelChoiceLength: modelChoice.length },
          evidenceLevel: 'VERIFIED'
        },
        missionId,
        threadId,
        onEvent
      );

      lmStudioThreadStore.addAuditLog({
        id: `audit_${Date.now()}`,
        timestamp: new Date().toISOString(),
        missionId,
        threadId,
        pluginMode: contract.mode,
        requestedAction: contract.objective,
        policyDecision: approvalRule.approvalNeeded ? 'REQUIRE_APPROVAL' : 'ALLOW',
        affectedFiles: contract.targetFiles || [],
        modelUsed: modelId,
        finalStatus: 'COMPLETED',
        evidenceLevel: 'VERIFIED',
        maskedOutput: LMStudioPolicyGate.maskSecrets(modelChoice.slice(0, 1000))
      });

      this.activeMissions.delete(missionId);
      return { success: true, output: modelChoice, patchProposed };
    } catch (err: any) {
      const errorMsg = `LM Studio uppdragsfel: ${err?.message || err}`;
      LMStudioEventMapper.mapAndEmit(
        {
          missionId,
          threadId,
          type: 'mission.failed',
          status: 'FAILED',
          summary: errorMsg,
          evidence: err,
          evidenceLevel: 'VERIFIED'
        },
        missionId,
        threadId,
        onEvent
      );

      this.activeMissions.delete(missionId);
      return { success: false, output: errorMsg };
    }
  }

  public cancelMission(missionId: string): boolean {
    const active = this.activeMissions.get(missionId);
    if (active) {
      active.cancelled = true;
      this.activeMissions.delete(missionId);
      return true;
    }
    return false;
  }
}

export const lmStudioRuntimeAdapter = new LMStudioRuntimeAdapter();
