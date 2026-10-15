import React from 'react';
import { Cpu, Wifi, BatteryCharging, ShieldCheck, Radio, Sparkles, Terminal, Code2, Server, Mic, Bot, Database, Globe, Settings, CheckSquare, Activity, History, Info, Download, FileJson, Rocket, DollarSign, Award, Store, Zap, ZapOff, ShoppingCart } from 'lucide-react';
import { DeviceTelemetry, OllamaModel } from '../types';

export type TabType = 'aura-ide' | 'jaco-bot' | 'autopilot' | 'keep' | 'hardening' | 'openclaw' | 'models' | 'voice' | 'ide' | 'socket' | 'terminal' | 'setup' | 'cuda-quantum' | 'litert' | 'diagnostics' | 'history' | 'intelligence' | 'processes' | 'antigravity' | 'memorystore' | 'revenue' | 'checkout' | 'verified-capabilities' | 'verified-marketplaces' | 'cost-orchestrator';

interface HeaderProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  telemetry: DeviceTelemetry;
  activeModel?: OllamaModel;
  isRecordingVoice: boolean;
  onToggleVoice: () => void;
  onOpenWizard: () => void;
  onOpenTodo: () => void;
  onExportCheckpoint?: () => void;
  isPowerSaver?: boolean;
  onTogglePowerSaver?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  telemetry,
  activeModel,
  isRecordingVoice,
  onToggleVoice,
  onOpenWizard,
  onOpenTodo,
  onExportCheckpoint,
  isPowerSaver = false,
  onTogglePowerSaver
}) => {
  return (
    <header className="backdrop-blur-2xl bg-slate-950/65 border-b border-white/10 text-slate-100 sticky top-0 z-40 font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {/* Top System Status Bar */}
      <div className="bg-slate-950/70 px-3 py-1 border-b border-white/5 flex flex-wrap items-center justify-between text-[10px] text-slate-400 backdrop-blur-md gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-cyan-300 font-semibold">
            <ShieldCheck className="w-3 h-3 text-cyan-400" />
            <span>Private NPU</span>
          </span>
          <span className="text-slate-700">|</span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Cpu className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>NPU: <strong className="text-cyan-300 font-bold">{telemetry.npuLoad ?? telemetry.npuUsagePercent}%</strong></span>
          </span>
          <span className="hidden sm:inline-block text-slate-700">|</span>
          <span className="hidden sm:inline-flex items-center gap-1 text-slate-400">
            RAM: <strong className="text-slate-200">{telemetry.ramUsedGb}G</strong>/{telemetry.ramTotalGb}G
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          {onTogglePowerSaver && (
            <button
              onClick={onTogglePowerSaver}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                isPowerSaver
                  ? 'bg-amber-950/90 text-amber-300 border-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)] animate-pulse'
                  : 'bg-slate-900/80 text-slate-400 border-slate-700/60 hover:text-slate-200 hover:border-slate-500'
              }`}
              title={
                isPowerSaver
                  ? 'Power Saver PÅ: Telemetri synkas var 12:e sekund. Bakgrundsprocesser pausade.'
                  : 'Power Saver AV: Normal telemetrisynk (3s).'
              }
            >
              {isPowerSaver ? (
                <ZapOff className="w-3 h-3 text-amber-400" />
              ) : (
                <Zap className="w-3 h-3 text-slate-400" />
              )}
              <span>{isPowerSaver ? 'Power Saver: PÅ (12s)' : 'Power Saver: AV'}</span>
            </button>
          )}

          <span className="inline-flex items-center gap-1 text-slate-400">
            <Wifi className="w-3 h-3 text-slate-400" />
            {telemetry.localIp}:{telemetry.socketPort}
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-slate-400">
            <BatteryCharging className="w-3 h-3" />
            {telemetry.batteryLevel}%
          </span>
        </div>
      </div>

      {/* Main Header Brand & Navigation Controls */}
      <div className="px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center font-bold text-cyan-400 text-[10px] shadow-[0_0_8px_rgba(34,211,238,0.4)] shrink-0">
            <Bot className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 leading-tight">
              <h1 className="text-xs font-bold text-slate-100 font-sans tracking-tight truncate">
                JACO Autonomous IDE
              </h1>
              <span className="px-1.5 py-0.2 text-[9px] uppercase font-mono font-semibold rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 shrink-0">
                NPU
              </span>
              {isPowerSaver && (
                <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded bg-amber-950 text-amber-300 border border-amber-600/50 shrink-0 animate-pulse">
                  ⚡ SPARLÄGE
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              Modell: <strong className="text-cyan-200 font-normal">{activeModel ? activeModel.name : 'nemotron-4b'}</strong>
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
          {onTogglePowerSaver && (
            <button
              onClick={onTogglePowerSaver}
              className={`flex items-center gap-1 px-2 py-1 rounded font-medium border transition-all ${
                isPowerSaver
                  ? 'bg-amber-950 text-amber-300 border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.25)] font-bold'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
              title="Växla Power Saver-läge för att spara batteri och minska CPU/NPU-polling"
            >
              {isPowerSaver ? (
                <ZapOff className="w-3 h-3 text-amber-400" />
              ) : (
                <Zap className="w-3 h-3 text-slate-400" />
              )}
              <span className="hidden sm:inline">
                {isPowerSaver ? 'Sparläge: PÅ' : 'Sparläge'}
              </span>
            </button>
          )}

          {onExportCheckpoint && (
            <button
              onClick={onExportCheckpoint}
              title="Exportera Checkpoint JSON"
              className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm transition-all"
            >
              <FileJson className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Checkpoint</span>
            </button>
          )}

          <button
            onClick={onOpenTodo}
            className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 font-medium border border-cyan-800/60 transition-colors"
          >
            <CheckSquare className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">Todo</span>
          </button>

          <button
            onClick={onOpenWizard}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 font-medium border border-slate-700/80 transition-colors"
          >
            <Settings className="w-3 h-3 text-slate-400" />
            <span className="hidden sm:inline">Setup</span>
          </button>

          <button
            onClick={onToggleVoice}
            className={`flex items-center gap-1 px-2 py-1 rounded font-medium border transition-colors ${
              isRecordingVoice
                ? 'bg-rose-950 text-rose-200 border-rose-600 animate-pulse'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
            }`}
          >
            <Mic className="w-3 h-3 text-cyan-400" />
            <span className="hidden md:inline">{isRecordingVoice ? 'Lyssnar' : 'Röst'}</span>
          </button>
        </div>
      </div>

      {/* Aura is the product workspace. Former top-level pages are now capabilities in Aura Tool Fabric. */}
      <nav className="px-3 py-1.5 bg-black/60 border-t border-cyan-900/30 flex items-center justify-between gap-3 text-xs">
        <button
          onClick={() => setActiveTab('aura-ide')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded border font-semibold transition-colors ${
            activeTab === 'aura-ide'
              ? 'border-cyan-500/60 text-cyan-200 bg-cyan-950/70'
              : 'border-slate-700 text-slate-300 hover:text-cyan-200 hover:border-cyan-800'
          }`}
          title="Return to the canonical JACO workspace"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Aura Workspace</span>
        </button>
        <div className="min-w-0 text-[10px] text-slate-500 truncate">
          Capabilities, integrations, diagnostics and legacy surfaces are available through Aura → Tools / Command Palette.
        </div>
      </nav>
    </header>
  );
};
