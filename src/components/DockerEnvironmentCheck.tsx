import React, { useState, useEffect } from 'react';
import { Terminal, ShieldAlert, CheckCircle2, Copy, Check, RefreshCw, Layers, Server, Cpu } from 'lucide-react';
import { TermuxBridge } from '../lib/termuxBridge';

export interface DockerCheckResult {
  hasDocker: boolean;
  dockerPath: string | null;
  hasProotDistro: boolean;
  prootDistroList: string | null;
  installedDistros: string[];
  recommendedBootstrapCmd: string;
  checkedAt: string;
  error?: string | null;
}

export const PROOT_BOOTSTRAP_CMD = 'pkg install proot-distro -y && proot-distro install ubuntu && proot-distro login ubuntu';

export async function runDockerEnvironmentCheck(): Promise<DockerCheckResult> {
  let dockerPath: string | null = null;
  let hasDocker = false;
  let prootDistroList: string | null = null;
  let hasProotDistro = false;
  const installedDistros: string[] = [];

  try {
    // 1. Run 'which docker' command via TermuxBridge
    const dockerRes = await TermuxBridge.executeCommand('which docker');
    if (
      dockerRes &&
      typeof dockerRes === 'string' &&
      dockerRes.trim().length > 0 &&
      !dockerRes.includes('not found') &&
      !dockerRes.includes('no docker in')
    ) {
      dockerPath = dockerRes.trim();
      hasDocker = true;
    }

    // 2. Run 'proot-distro list' command via TermuxBridge
    const prootRes = await TermuxBridge.executeCommand('proot-distro list');
    if (prootRes && typeof prootRes === 'string' && !prootRes.includes('command not found')) {
      prootDistroList = prootRes.trim();
      hasProotDistro = true;

      // Extract installed distributions
      const lines = prootRes.split('\n');
      for (const line of lines) {
        if (line.includes('installed') || line.includes('*')) {
          const match = line.match(/([a-zA-Z0-9_-]+)\s*\(installed\)/i) || line.match(/[\*\s]+([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            installedDistros.push(match[1]);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[DockerEnvironmentCheck] Error running environment checks:', err);
  }

  return {
    hasDocker,
    dockerPath,
    hasProotDistro,
    prootDistroList,
    installedDistros,
    recommendedBootstrapCmd: PROOT_BOOTSTRAP_CMD,
    checkedAt: new Date().toLocaleTimeString()
  };
}

interface DockerEnvironmentCheckProps {
  onCheckComplete?: (result: DockerCheckResult) => void;
  compact?: boolean;
}

export const DockerEnvironmentCheck: React.FC<DockerEnvironmentCheckProps> = ({
  onCheckComplete,
  compact = false
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<DockerCheckResult | null>(null);
  const [copied, setCopied] = useState(false);

  const performCheck = async () => {
    setIsChecking(true);
    const res = await runDockerEnvironmentCheck();
    setResult(res);
    setIsChecking(false);
    if (onCheckComplete) {
      onCheckComplete(res);
    }
  };

  useEffect(() => {
    performCheck();
  }, []);

  const handleCopyCmd = () => {
    const cmd = result?.recommendedBootstrapCmd || PROOT_BOOTSTRAP_CMD;
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 font-mono text-xs">
      {/* Module Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-slate-100 text-xs">DockerEnvironmentCheck (TermuxBridge)</span>
        </div>
        <button
          type="button"
          onClick={performCheck}
          disabled={isChecking}
          className="px-2.5 py-1 bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-300 rounded text-[11px] flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 text-cyan-400 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'Kontrollerar...' : 'Kör Kontroll'}</span>
        </button>
      </div>

      {/* Output / Results */}
      {isChecking && !result && (
        <div className="p-3 bg-slate-900/60 rounded-lg text-slate-400 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
          <span>Kör 'which docker' och 'proot-distro list' via TermuxBridge...</span>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Status Badges */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className={`p-2 rounded-lg border flex items-center gap-2 ${
              result.hasDocker 
                ? 'bg-cyan-950/40 border-emerald-800/60 text-emerald-300' 
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}>
              {result.hasDocker ? <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" /> : <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />}
              <div>
                <div className="font-bold">Docker CLI</div>
                <div className="text-[10px] text-slate-400 truncate">{result.hasDocker ? result.dockerPath : 'Ej hittad i PATH'}</div>
              </div>
            </div>

            <div className={`p-2 rounded-lg border flex items-center gap-2 ${
              result.hasProotDistro 
                ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300' 
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}>
              <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="font-bold">proot-distro</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {result.hasProotDistro 
                    ? `${result.installedDistros.length > 0 ? result.installedDistros.join(', ') : 'Tillgänglig'}` 
                    : 'Ej installerad'}
                </div>
              </div>
            </div>
          </div>

          {/* DOCKER NOT FOUND ALERT BANNER */}
          {!result.hasDocker && (
            <div className="p-3 bg-rose-950/60 border border-rose-700/80 rounded-xl space-y-2 animate-in fade-in duration-300">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-rose-200 text-xs">
                    Varning: Docker saknas i nuvarande miljö!
                  </h4>
                  <p className="text-[11px] text-rose-200/90 leading-relaxed">
                    Termux på Android saknar inbyggd cgroups/docker-daemon stöd i standard-kerneln. För att köra fullständiga containers eller isolerade Linux-servrar rekommenderas <strong>proot-distro (Ubuntu PRoot)</strong>.
                  </p>
                </div>
              </div>

              {/* Recommended Bootstrap Command Box */}
              <div className="bg-slate-950 border border-rose-900/80 p-2.5 rounded-lg space-y-1.5">
                <div className="text-[10px] text-slate-400 flex items-center justify-between">
                  <span>Manuellt bootstrap-kommando för proot-distro:</span>
                  <button
                    type="button"
                    onClick={handleCopyCmd}
                    className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-sans text-[11px] font-bold"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-cyan-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Kopierat!' : 'Kopiera'}</span>
                  </button>
                </div>
                <code className="block bg-slate-900 p-2 rounded text-emerald-300 text-[11px] overflow-x-auto selection:bg-emerald-900 select-all border border-slate-800">
                  {result.recommendedBootstrapCmd}
                </code>
              </div>
            </div>
          )}

          {/* DOCKER FOUND SUCCESS BANNER */}
          {result.hasDocker && (
            <div className="p-3 bg-cyan-950/60 border border-emerald-700/80 rounded-xl flex items-center gap-3 text-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0" />
              <div>
                <div className="font-bold text-emerald-300">Docker verifierad!</div>
                <div className="text-[11px] text-emerald-200/80">
                  Binary hittad på <code>{result.dockerPath}</code>. Docker-containerering är aktiv.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
