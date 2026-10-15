import React, { useState, useEffect } from 'react';
import { Terminal } from 'lucide-react';

interface ActiveProcessesProps {
  isPowerSaver?: boolean;
}

export function ActiveProcesses({ isPowerSaver = false }: ActiveProcessesProps) {
  const [processData, setProcessData] = useState<string>('Loading processes...');

  useEffect(() => {
    let mounted = true;
    const fetchProcesses = async () => {
      try {
        const res = await fetch('/api/processes');
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.processes) {
            setProcessData(data.processes);
          }
        } else {
          setProcessData('Failed to load processes.');
        }
      } catch (err) {
        if (mounted) setProcessData('Error loading processes.');
      }
    };

    fetchProcesses();
    const pollInterval = isPowerSaver ? 10000 : 2000;
    const interval = setInterval(fetchProcesses, pollInterval);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isPowerSaver]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex flex-col h-full shadow-lg">
      <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Active System Processes</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-slate-400 font-mono">LIVE_MONITOR</span>
        </div>
      </div>
      
      <div className="p-4 bg-[#0a0a0a] flex-1 overflow-auto">
        <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap leading-relaxed">
          {processData}
        </pre>
      </div>
    </div>
  );
}
