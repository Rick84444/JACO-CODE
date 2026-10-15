import React, { useMemo } from 'react';
import { CheckCircle2, CircleDashed, ShieldAlert } from 'lucide-react';
import { JacoWordmark } from './JacoWordmark';

export interface AuraRuntimeNucleusProps {
  workplace: { reachable: boolean; status: string } | null | undefined;
  seer: { phase: string | null; activeModule: string | null; latestVerifiedProgress: string | null } | null | undefined;
  mission: any | null | undefined;
  // The most recent mission (any status), so evidence and state stay visible after it finished.
  latestMission?: { id: string; status: string; verifiedReceipts: number } | null;
  mcpProviders: Array<{ id: string; name: string; status: string }> | null | undefined;
  approvalCount: number | null | undefined;
  activity: Array<{ id: string; source: string; type: string; verified: boolean | null }> | null | undefined;
  integrations?: {
    remote?: { state?: string; ready?: boolean; windowsObserved?: number };
    cdp?: { state?: string; targetCount?: number };
    vscode?: { state?: string; windowCount?: number };
    chatgpt?: { state?: string; note?: string };
  } | null;
}

type RailState = 'OBSERVED' | 'VERIFIED' | 'AWAITING_REVIEW' | 'UNOBSERVED';

const colorFor = (state: RailState) => ({
  OBSERVED: 'text-cyan-300 border-cyan-900/80 bg-cyan-950/20',
  VERIFIED: 'text-emerald-300 border-emerald-900/80 bg-emerald-950/20',
  AWAITING_REVIEW: 'text-amber-300 border-amber-900/80 bg-amber-950/20',
  UNOBSERVED: 'text-slate-500 border-slate-800 bg-slate-900/40',
}[state]);

const normalizedState = (value?: string | null): RailState => {
  const state = String(value || '').toUpperCase();
  if (state === 'VERIFIED') return 'VERIFIED';
  if (state === 'OBSERVED' || state === 'READY' || state === 'ONLINE') return 'OBSERVED';
  return 'UNOBSERVED';
};

/**
 * A visual projection of existing runtime observations. It intentionally owns no
 * connection state: every illuminated path has a corresponding live object or
 * receipt in the Aura workbench snapshot.
 *
 * The sphere is therefore an observation projection, not decorative telemetry:
 * truth controls the light. It does not invent activity or synthesize runtime state.
 */
export const AuraRuntimeNucleus: React.FC<AuraRuntimeNucleusProps> = ({
  workplace, seer, mission, latestMission, mcpProviders, approvalCount, activity, integrations,
}) => {
  const view = useMemo(() => {
    const verifiedReceipts = Array.isArray(mission?.receipts)
      ? mission.receipts.filter((receipt: any) => receipt?.verified === true).length
      : Number(latestMission?.verifiedReceipts || 0);
    const observedMcp = (mcpProviders || []).filter(provider => provider.status === 'READY');
    const pending = Number(approvalCount || 0);
    const missionState = String(mission?.status || mission?.phase || (latestMission ? `senaste ${latestMission.status}` : '')).toUpperCase();
    const missionObserved = Boolean(mission?.id || latestMission?.id || seer?.phase || seer?.activeModule);

    return {
      verifiedReceipts,
      pending,
      nodes: [
        { id: 'workplace', label: 'WORKPLACE', state: workplace?.reachable ? 'OBSERVED' : 'UNOBSERVED' as RailState, detail: workplace?.reachable ? workplace.status : 'not observed' },
        { id: 'seer', label: 'SEER', state: seer?.phase ? 'OBSERVED' : 'UNOBSERVED' as RailState, detail: seer?.phase || 'not observed' },
        { id: 'mission', label: 'MISSION', state: pending > 0 ? 'AWAITING_REVIEW' : missionObserved ? 'OBSERVED' : 'UNOBSERVED' as RailState, detail: pending > 0 ? `${pending} approval(s) waiting` : missionState || 'no mission' },
        { id: 'tools', label: 'TOOL FABRIC', state: observedMcp.length ? 'OBSERVED' : 'UNOBSERVED' as RailState, detail: observedMcp.length ? observedMcp.map(provider => provider.name).join(', ') : 'no MCP runtime observed' },
        { id: 'evidence', label: 'EVIDENCE', state: verifiedReceipts ? 'VERIFIED' : 'UNOBSERVED' as RailState, detail: verifiedReceipts ? `${verifiedReceipts} verified receipt(s)${mission?.id ? '' : ' (latest mission)'}` : 'no verified receipt observed' },
      ],
      integrations: [
        { id: 'remote', label: 'REMOTE', state: normalizedState(integrations?.remote?.state), detail: integrations?.remote?.ready ? `verified · ${integrations?.remote?.windowsObserved || 0} window(s)` : `${integrations?.remote?.windowsObserved || 0} window(s) observed` },
        { id: 'cdp', label: 'CDP', state: normalizedState(integrations?.cdp?.state), detail: `${integrations?.cdp?.targetCount || 0} browser target(s)` },
        { id: 'vscode', label: 'VS CODE', state: normalizedState(integrations?.vscode?.state), detail: `${integrations?.vscode?.windowCount || 0} window(s) observed` },
        { id: 'chatgpt', label: 'CHATGPT', state: normalizedState(integrations?.chatgpt?.state), detail: integrations?.chatgpt?.note || 'connector not observed' },
      ],
      activityCount: (activity || []).length,
    };
  }, [activity, approvalCount, integrations, mcpProviders, mission, seer, workplace]);

  const activePaths = view.nodes.filter(node => node.state !== 'UNOBSERVED').length;
  const currentPhase = String(mission?.phase || mission?.status || seer?.phase || 'IDLE').toUpperCase();
  const currentActor = seer?.activeModule || (mission?.id ? 'NOVA MISSION' : 'JACO');

  return (
    <section
      className="h-full min-h-[300px] relative overflow-hidden bg-[#03080d] border-l border-[#183448]"
      aria-label="JACO runtime visualization"
    >
      <div
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(14,165,233,0.18), transparent 32%), radial-gradient(circle at 50% 80%, rgba(8,47,73,0.24), transparent 35%), linear-gradient(180deg,#06111a,#02060a)',
        }}
      />
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56,189,248,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.12) 1px,transparent 1px)',
          backgroundSize: '34px 34px',
          maskImage: 'linear-gradient(to bottom, black, transparent 88%)',
        }}
      />

      <div className="relative z-10 h-full min-h-0 flex flex-col">
        <header className="h-12 px-4 shrink-0 border-b border-[#183448] flex items-center justify-between bg-[#02070c]/85 backdrop-blur">
          <div className="flex items-center gap-2.5 min-w-0">
            <JacoWordmark size="sm" />
            <div className="hidden 2xl:block min-w-0">
              <div className="text-[8px] tracking-[0.24em] text-cyan-200/80">COGNITIVE RUNTIME</div>
              <div className="text-[7px] tracking-[0.15em] text-slate-600 mt-0.5">RUNTIME · OBSERVERAT TILLSTÅND</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-cyan-300">{currentActor}</div>
            <div className="text-[8px] text-slate-500">{currentPhase}</div>
          </div>
        </header>

        <div className="flex-1 min-h-0 grid grid-rows-[minmax(230px,1fr)_auto]">
          <div className="relative min-h-0 flex items-center justify-center overflow-hidden">
            <div className="absolute left-1/2 top-1/2 w-[86%] max-w-[455px] aspect-square -translate-x-1/2 -translate-y-1/2">
              {/* Operator decision: the logo is the centre piece; the sphere artwork was removed. */}
              <div className="absolute inset-[4%] rounded-full border border-cyan-800/20" />
              <div className={`absolute left-[38%] top-[34%] w-[62%] -translate-x-1/2 -translate-y-1/2 flex justify-center ${activePaths ? 'opacity-100' : 'opacity-60 grayscale'}`}>
                <img src="/branding/jaco-logo.png" alt="JACO IDE" className="w-full h-auto object-contain select-none pointer-events-none" draggable={false} />
              </div>

              <div className="absolute left-1/2 bottom-[6%] -translate-x-1/2 z-20 rounded border border-cyan-800/50 bg-[#02070c]/80 backdrop-blur px-2.5 py-1 text-center shadow-[0_0_18px_rgba(14,165,233,.16)]">
                <div className="text-[7px] tracking-[0.28em] text-cyan-100/80">JACO COGNITIVE RUNTIME</div>
                <div className="text-[6px] tracking-[0.14em] text-slate-500 mt-0.5">{activePaths} LIVE PATH{activePaths === 1 ? '' : 'S'}</div>
              </div>

              {view.nodes.map((node, index) => {
                const angle = (index * 72 - 90) * (Math.PI / 180);
                const x = 50 + Math.cos(angle) * 43;
                const y = 50 + Math.sin(angle) * 43;
                const lit = node.state !== 'UNOBSERVED';
                return (
                  <span
                    key={node.id}
                    title={`${node.label}: ${node.detail}`}
                    className={`absolute w-2.5 h-2.5 rounded-full border z-20 ${lit ? 'bg-cyan-200 border-white/70 shadow-[0_0_12px_rgba(34,211,238,.95)]' : 'bg-slate-900 border-slate-600'}`}
                    style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                  />
                );
              })}
            </div>

            <div className="absolute left-3 top-3 space-y-1 max-w-[42%]">
              {view.nodes.slice(0, 3).map(node => (
                <div key={node.id} className="grid grid-cols-[62px_minmax(0,1fr)] gap-1.5 items-center text-[8px]">
                  <span className="text-slate-600">{node.label}</span>
                  <span className={`border rounded px-1 py-0.5 truncate ${colorFor(node.state)}`} title={node.detail}>{node.state}</span>
                </div>
              ))}
            </div>

            <div className="absolute right-3 bottom-3 space-y-1.5 w-[118px] xl:w-[145px]">
              {view.integrations.map(node => (
                <div key={node.id} className="border border-[#19384b] bg-[#06111a]/90 rounded px-2 py-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[8px] text-slate-400">{node.label}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${node.state === 'VERIFIED' ? 'bg-emerald-300 shadow-[0_0_7px_rgba(110,231,183,.9)]' : node.state === 'OBSERVED' ? 'bg-cyan-300 shadow-[0_0_7px_rgba(103,232,249,.8)]' : 'bg-slate-700'}`} />
                  </div>
                  <div className="text-[7px] text-slate-600 truncate mt-0.5" title={node.detail}>{node.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[#183448] bg-[#050d14]/90 px-3 py-2 grid grid-cols-3 gap-2 text-[8px]">
            <div><span className="text-slate-600 block">EXECUTION PATHS</span><span className="text-cyan-300">{activePaths} observed</span></div>
            <div><span className="text-slate-600 block">EVIDENCE</span><span className={view.verifiedReceipts ? 'text-emerald-300' : 'text-slate-500'}>{view.verifiedReceipts} verified</span></div>
            <div><span className="text-slate-600 block">OPERATOR</span><span className={view.pending ? 'text-amber-300' : 'text-emerald-300'}>{view.pending ? `${view.pending} approval(s)` : 'no decision pending'}</span></div>
          </div>
        </div>

        <div className="h-8 px-3 border-t border-[#183448] shrink-0 flex items-center gap-3 text-[8px]">
          <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="w-3 h-3" />{view.verifiedReceipts} verified</span>
          <span className="flex items-center gap-1 text-amber-300"><ShieldAlert className="w-3 h-3" />{view.pending} approval{view.pending === 1 ? '' : 's'}</span>
          <span className="flex items-center gap-1 text-slate-500"><CircleDashed className="w-3 h-3" />{view.activityCount} event(s)</span>
          <span className="ml-auto text-[7px] tracking-wider text-slate-700">TRUTH BEFORE APPEARANCE</span>
        </div>
      </div>
    </section>
  );
};

export default AuraRuntimeNucleus;
