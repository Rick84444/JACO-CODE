import React, { useState } from 'react';
import { Terminal as TerminalIcon, Send, Trash2, CheckCircle2, AlertCircle, Info, Cpu, Play, Plus, Save, ListChecks, Sparkles, X, Edit2, Clock } from 'lucide-react';
import { TerminalLog } from '../types';
import { TerminalUtilities } from './TerminalUtilities';

interface AutomationScript {
  id: string;
  name: string;
  description: string;
  commands: string[];
  lastRun?: string;
}

interface TerminalDrawerProps {
  logs: TerminalLog[];
  onRunCommand: (command: string) => void;
  onClearLogs?: () => void;
}

const DEFAULT_SCRIPTS: AutomationScript[] = [
  {
    id: 'script-npu-test',
    name: 'Full NPU Build & Vitest Verification',
    description: 'Runs AST checks, Ollama model status, and unit tests',
    commands: ['ollama ps', 'npx vitest run', 'git status'],
    lastRun: '10 mins ago'
  },
  {
    id: 'script-termux-socket',
    name: 'Android Termux WebSocket Relay Init',
    description: 'Sets OLLAMA_HOST origin and boots local server.ts',
    commands: ['export OLLAMA_HOST=0.0.0.0:11434', 'export OLLAMA_ORIGINS="*"', 'node server.ts'],
    lastRun: '1 hour ago'
  },
  {
    id: 'script-model-pull',
    name: 'Pull DeepSeek & Check Memory',
    description: 'Pulls DeepSeek-Coder-6.7b and checks memory allocations',
    commands: ['ollama pull deepseek-coder:6.7b', 'free -h', 'ollama list'],
  }
];

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  logs,
  onRunCommand,
  onClearLogs
}) => {
  const [commandInput, setCommandInput] = useState('');
  const [scripts, setScripts] = useState<AutomationScript[]>(DEFAULT_SCRIPTS);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);
  const [activeScriptStep, setActiveScriptStep] = useState<number>(-1);
  const [showScriptModal, setShowScriptModal] = useState(false);

  // New script form state
  const [newScriptName, setNewScriptName] = useState('');
  const [newScriptDesc, setNewScriptDesc] = useState('');
  const [newScriptCommands, setNewScriptCommands] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    onRunCommand(commandInput.trim());
    setCommandInput('');
  };

  // Run a sequence of commands sequentially
  const handleExecuteScript = async (script: AutomationScript) => {
    if (runningScriptId) return;
    setRunningScriptId(script.id);

    // Update last run timestamp
    setScripts(prev => prev.map(s => s.id === script.id ? { ...s, lastRun: 'Just now' } : s));

    for (let i = 0; i < script.commands.length; i++) {
      setActiveScriptStep(i);
      const cmd = script.commands[i];
      onRunCommand(cmd);
      // Brief delay between script steps for realistic sequence feel
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    setRunningScriptId(null);
    setActiveScriptStep(-1);
  };

  const handleSaveNewScript = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScriptName.trim() || !newScriptCommands.trim()) return;

    const parsedCommands = newScriptCommands
      .split('\n')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    if (parsedCommands.length === 0) return;

    const newScript: AutomationScript = {
      id: `script-${Date.now()}`,
      name: newScriptName.trim(),
      description: newScriptDesc.trim() || 'Custom terminal automation script',
      commands: parsedCommands,
      lastRun: 'Never'
    };

    setScripts(prev => [newScript, ...prev]);
    setNewScriptName('');
    setNewScriptDesc('');
    setNewScriptCommands('');
    setShowScriptModal(false);
  };

  const handleDeleteScript = (id: string) => {
    setScripts(prev => prev.filter(s => s.id !== id));
  };

  const quickCommands = [
    'npx vitest run',
    'ollama list',
    'git status',
    'node server.ts'
  ];

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      {/* Reusable Automation Scripts Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
              <ListChecks className="w-4 h-4 text-cyan-400" />
              Terminal Automation Scripts
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Save and execute multi-step terminal command sequences with one click.
            </p>
          </div>

          <button
            onClick={() => setShowScriptModal(true)}
            className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-mono text-xs font-bold flex items-center gap-1.5 transition-colors shadow-md"
          >
            <Plus className="w-3.5 h-3.5" /> New Automation Script
          </button>
        </div>

        {/* Script Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {scripts.map((script) => {
            const isRunning = runningScriptId === script.id;

            return (
              <div
                key={script.id}
                className={`p-3.5 rounded-xl border font-mono text-xs transition-all flex flex-col justify-between space-y-3 ${
                  isRunning
                    ? 'bg-slate-950 border-cyan-500 shadow-lg shadow-cyan-950/40'
                    : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-slate-100 text-xs truncate">{script.name}</h4>
                    <button
                      onClick={() => handleDeleteScript(script.id)}
                      className="text-slate-600 hover:text-rose-400 transition-colors p-1"
                      title="Delete script"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{script.description}</p>
                </div>

                {/* Commands Preview List */}
                <div className="bg-slate-900/90 p-2 rounded border border-slate-800/80 space-y-1 text-[10px]">
                  {script.commands.map((cmd, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-1.5 ${
                        isRunning && activeScriptStep === idx
                          ? 'text-cyan-400 font-bold bg-slate-800/80 p-0.5 rounded'
                          : 'text-slate-400'
                      }`}
                    >
                      <span className="text-slate-600">{idx + 1}.</span>
                      <span className="truncate">$ {cmd}</span>
                    </div>
                  ))}
                </div>

                {/* Execution Button */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-600" /> {script.lastRun || 'Never run'}
                  </span>

                  <button
                    onClick={() => handleExecuteScript(script)}
                    disabled={!!runningScriptId}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isRunning
                        ? 'bg-amber-600 text-white animate-pulse'
                        : 'bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-40'
                    }`}
                  >
                    <Play className="w-3 h-3" />
                    <span>{isRunning ? 'Running...' : 'Run Sequence'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal Output Window */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden font-mono text-xs flex flex-col h-[480px]">
        {/* Terminal Title Bar */}
        <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-cyan-400" />
            <span className="text-white font-bold">Android Termux / Antigravity Shell</span>
            <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded">ARM64 NPU</span>
          </div>

          <div className="flex items-center gap-2">
            {quickCommands.map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => onRunCommand(cmd)}
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition-colors"
              >
                <Play className="w-3 h-3 text-cyan-400" /> {cmd}
              </button>
            ))}
          </div>
        </div>

        {/* Streaming Logs Body */}
        <div className="flex-1 p-4 space-y-2 overflow-y-auto font-mono text-xs">
          {logs.map((log) => {
            let badgeStyle = 'bg-slate-800 text-slate-300';
            if (log.type === 'ollama') badgeStyle = 'bg-cyan-950 text-cyan-300 border border-cyan-800';
            if (log.type === 'antigravity') badgeStyle = 'bg-purple-950 text-purple-300 border border-purple-800';
            if (log.type === 'success') badgeStyle = 'bg-cyan-950 text-emerald-300 border border-emerald-800';
            if (log.type === 'error') badgeStyle = 'bg-rose-950 text-rose-300 border border-rose-800';
            if (log.type === 'command') badgeStyle = 'bg-amber-950 text-amber-300 border border-amber-800';

            return (
              <div key={log.id} className="flex items-start gap-3 hover:bg-slate-900/50 p-1.5 rounded transition-colors">
                <span className="text-slate-600 shrink-0 select-none text-[10px] pt-0.5">
                  {log.timestamp}
                </span>

                <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase shrink-0 ${badgeStyle}`}>
                  {log.type}
                </span>

                <pre className="text-slate-200 whitespace-pre-wrap font-mono flex-1 leading-relaxed">
                  {log.message}
                </pre>
              </div>
            );
          })}
        </div>

        {/* Command Input Prompt */}
        <form onSubmit={handleSubmit} className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
          <span className="text-cyan-400 font-bold select-none">$</span>
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Type Android terminal command e.g. 'npx vitest run' or 'ollama ps'"
            className="flex-1 bg-transparent border-none text-slate-100 placeholder-slate-600 focus:outline-none font-mono text-xs"
          />
          <button
            type="submit"
            disabled={!commandInput.trim()}
            className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded font-mono text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Send className="w-3.5 h-3.5" /> Run
          </button>
        </form>
      </div>

      {/* Terminal Utilities */}
      <div className="pt-4">
        <TerminalUtilities onRunCommand={onRunCommand} />
      </div>

      {/* New Automation Script Modal */}
      {showScriptModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 font-mono shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-cyan-400" /> Save New Terminal Automation Script
              </h3>
              <button
                onClick={() => setShowScriptModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewScript} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-bold">Script Title</label>
                <input
                  type="text"
                  value={newScriptName}
                  onChange={(e) => setNewScriptName(e.target.value)}
                  placeholder="e.g. Build & Sync Workspace"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-bold">Description (Optional)</label>
                <input
                  type="text"
                  value={newScriptDesc}
                  onChange={(e) => setNewScriptDesc(e.target.value)}
                  placeholder="e.g. Sequentially runs vitest and git push"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-bold">Command Sequence (One command per line)</label>
                <textarea
                  rows={4}
                  value={newScriptCommands}
                  onChange={(e) => setNewScriptCommands(e.target.value)}
                  placeholder={'ollama ps\nnpx vitest run\ngit status'}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-cyan-300 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500 leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScriptModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold transition-colors flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" /> Save Script
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

