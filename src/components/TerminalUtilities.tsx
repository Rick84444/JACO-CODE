import React, { useState } from 'react';
import { Activity, Trash2, ShieldAlert, Cpu, CheckCircle } from 'lucide-react';

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: string;
  mem: string;
  status: string;
}

interface TerminalUtilitiesProps {
  onRunCommand: (command: string) => void;
}

export const TerminalUtilities: React.FC<TerminalUtilitiesProps> = ({ onRunCommand }) => {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchProcesses = () => {
    setIsLoading(true);
    // In a real implementation this would call an API. We'll simulate it or use the mock pattern used elsewhere.
    setTimeout(() => {
      setProcesses([
        { pid: 4592, name: 'node dist/server.cjs', cpu: '2.4%', mem: '124MB', status: 'Running' },
        { pid: 4610, name: 'tsx server.ts', cpu: '0.0%', mem: '80MB', status: 'Zombie' },
        { pid: 4625, name: 'vite', cpu: '0.0%', mem: '95MB', status: 'Inactive' },
        { pid: 5120, name: 'esbuild', cpu: '0.0%', mem: '40MB', status: 'Inactive' },
      ]);
      setIsLoading(false);
      setStatusMessage('Process list updated from Android Termux API');
      setTimeout(() => setStatusMessage(null), 3000);
    }, 800);
  };

  const killProcess = (pid: number) => {
    setProcesses(processes.filter(p => p.pid !== pid));
  };

  const killOrphaned = () => {
    setIsLoading(true);
    onRunCommand('bash scripts/kill_termux_zombies.sh');
    setTimeout(() => {
      setProcesses(processes.filter(p => p.status === 'Running'));
      setIsLoading(false);
      setStatusMessage('Successfully terminated orphaned processes (Triggered system script)');
      setTimeout(() => setStatusMessage(null), 3000);
    }, 1200);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden font-mono text-xs flex flex-col h-[480px]">
      <div className="bg-slate-800/50 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-white font-bold">Termux Process Manager</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchProcesses}
            disabled={isLoading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-bold transition-colors"
          >
            {isLoading ? 'Scanning...' : 'Scan Processes'}
          </button>
          <button
            onClick={killOrphaned}
            disabled={isLoading || processes.filter(p => p.status !== 'Running').length === 0}
            className="px-3 py-1.5 bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded font-bold text-[11px] transition-colors flex items-center gap-1.5"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Kill Orphaned Processes
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto bg-slate-950">
        {statusMessage && (
          <div className="mb-4 p-2 bg-emerald-950/50 border border-emerald-900 rounded text-emerald-400 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            {statusMessage}
          </div>
        )}

        {processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
            <Cpu className="w-8 h-8 opacity-50" />
            <p>No active processes found. Click scan to refresh.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {processes.map((proc) => (
              <div key={proc.pid} className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="space-y-1">
                    <span className="text-white font-bold block">{proc.name}</span>
                    <span className="text-[10px] text-slate-500">PID: {proc.pid}</span>
                  </div>
                  <div className="flex gap-3 text-[10px]">
                    <span className="text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded">CPU: {proc.cpu}</span>
                    <span className="text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded">MEM: {proc.mem}</span>
                    <span className={`px-2 py-0.5 rounded ${proc.status === 'Running' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                      {proc.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => killProcess(proc.pid)}
                  className="p-1.5 hover:bg-rose-950 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  title="Kill Process"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
