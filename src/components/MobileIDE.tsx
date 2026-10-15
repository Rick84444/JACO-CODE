import React, { useState } from 'react';
import { Code2, Play, Pause, SkipForward, ArrowDown, Bug, AlertCircle, Save, FileCode, Layers, Database, RefreshCcw, FileJson } from 'lucide-react';
import { CodeFile, DebuggerSession } from '../types';

interface MobileIDEProps {
  files: CodeFile[];
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onUpdateFileContent: (path: string, content: string) => void;
  onRunTerminalCommand: (cmd: string) => void;
  onExportCheckpoint?: () => void;
}

export const MobileIDE: React.FC<MobileIDEProps> = ({
  files,
  activeFilePath,
  onSelectFile,
  onUpdateFileContent,
  onRunTerminalCommand,
  onExportCheckpoint
}) => {
  const activeFile = files.find(f => f.path === activeFilePath) || files[0];
  const [editorContent, setEditorContent] = useState(activeFile.content);

  // Debugger State
  const [debuggerSession, setDebuggerSession] = useState<DebuggerSession>({
    isRunning: false,
    currentLine: 12,
    currentFile: activeFile.filename,
    callStack: [
      { frame: 'calculateTensorDotProduct()', file: 'math.ts', line: 12 },
      { frame: 'app.post("/api/agent/command")', file: 'server.ts', line: 24 },
      { frame: 'expressInternalRouter()', file: 'express.js', line: 110 }
    ],
    variables: [
      { name: 'a', value: '[1, 2, 3, 4]', type: 'number[]' },
      { name: 'b', value: '[0.5, 1, 1.5, 2]', type: 'number[]' },
      { name: 'sum', value: '15.0', type: 'number' },
      { name: 'npuBuffer', value: '0x7ff8a02b11', type: 'HexagonTensorRef' }
    ],
    breakpoints: [
      { file: 'math.ts', line: 12, enabled: true },
      { file: 'server.ts', line: 24, enabled: true }
    ],
    memoryAllocatedMb: 342.8
  });

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditorContent(e.target.value);
    onUpdateFileContent(activeFile.path, e.target.value);
  };

  const toggleDebugState = () => {
    setDebuggerSession(prev => ({
      ...prev,
      isRunning: !prev.isRunning
    }));
  };

  const stepNextLine = () => {
    setDebuggerSession(prev => ({
      ...prev,
      currentLine: (prev.currentLine % 22) + 1,
      memoryAllocatedMb: parseFloat((prev.memoryAllocatedMb + (Math.random() * 2 - 0.5)).toFixed(1))
    }));
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      {/* IDE Workspace File Tabs */}
      <div className="flex items-center justify-between gap-2 bg-slate-900 p-2 rounded-xl border border-slate-800 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1">
          {files.map((file) => (
            <button
              key={file.id}
              onClick={() => {
                onSelectFile(file.path);
                setEditorContent(file.content);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-colors whitespace-nowrap ${
                file.path === activeFilePath
                  ? 'bg-slate-800 text-cyan-400 font-bold border border-cyan-800/80 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{file.filename}</span>
              {file.isDirty && <span className="w-2 h-2 rounded-full bg-amber-400" />}
              {file.errorsCount && file.errorsCount > 0 ? (
                <span className="px-1.5 py-0.2 bg-rose-950 text-rose-300 border border-rose-800 rounded text-[10px]">
                  {file.errorsCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {onExportCheckpoint && (
            <button
              onClick={onExportCheckpoint}
              title="Exportera workspace checkpoint JSON"
              className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 text-xs font-mono font-semibold rounded-lg border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.2)] transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileJson className="w-3.5 h-3.5 text-cyan-400" />
              <span>Exportera Checkpoint</span>
            </button>
          )}

          <button
            onClick={() => onRunTerminalCommand(`npx vitest run`)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 text-cyan-400" />
            <span>Run Vitest</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Code Editor + Debugger Console */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Code Editor Panel */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-[520px]">
          {/* Editor Top Toolbar */}
          <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-200 font-bold">{activeFile.path}</span>
              <span className="text-slate-500">({activeFile.language})</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-500">
                Line {debuggerSession.currentLine}, Col 14
              </span>
              <button
                onClick={() => onUpdateFileContent(activeFile.path, editorContent)}
                className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 rounded flex items-center gap-1 text-[11px]"
              >
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
          </div>

          {/* Editable Code Canvas */}
          <div className="flex-1 relative bg-slate-950 overflow-auto font-mono text-xs flex">
            {/* Line Numbers Column */}
            <div className="w-10 bg-slate-900/80 text-slate-600 select-none text-right pr-2 py-3 border-r border-slate-800 font-mono text-[11px] leading-relaxed">
              {editorContent.split('\n').map((_, idx) => {
                const lineNum = idx + 1;
                const isDebugLine = debuggerSession.isRunning && lineNum === debuggerSession.currentLine;
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-end gap-1 ${
                      isDebugLine ? 'bg-amber-500/20 text-amber-400 font-bold' : ''
                    }`}
                  >
                    {isDebugLine && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                    <span>{lineNum}</span>
                  </div>
                );
              })}
            </div>

            {/* Code Textarea */}
            <textarea
              value={editorContent}
              onChange={handleContentChange}
              spellCheck={false}
              className="w-full h-full bg-transparent p-3 text-slate-100 focus:outline-none resize-none leading-relaxed font-mono whitespace-pre"
            />
          </div>
        </div>

        {/* Debugger & Call Stack Side Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4 h-[520px] overflow-y-auto">
          <div>
            {/* Debugger Control Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Android Debugger
                </h3>
              </div>
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-mono ${
                debuggerSession.isRunning ? 'bg-cyan-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-400'
              }`}>
                {debuggerSession.isRunning ? 'Paused on Breakpoint' : 'Idle'}
              </span>
            </div>

            {/* Debug Action Controls */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={toggleDebugState}
                className={`flex-1 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  debuggerSession.isRunning
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {debuggerSession.isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{debuggerSession.isRunning ? 'Pause' : 'Debug Session'}</span>
              </button>

              <button
                onClick={stepNextLine}
                disabled={!debuggerSession.isRunning}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-mono font-medium flex items-center gap-1"
                title="Step Over (F10)"
              >
                <SkipForward className="w-3.5 h-3.5 text-cyan-400" /> Step
              </button>
            </div>

            {/* Variable Inspection Table */}
            <div className="mt-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider block">
                Local Variables
              </span>
              <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-800 font-mono text-[11px] space-y-1.5">
                {debuggerSession.variables.map((v, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-slate-900 pb-1">
                    <span className="text-cyan-400 font-semibold">{v.name}:</span>
                    <span className="text-amber-300">{v.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Call Stack */}
            <div className="mt-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider block">
                Active Call Stack
              </span>
              <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-800 font-mono text-[11px] space-y-1.5">
                {debuggerSession.callStack.map((stack, idx) => (
                  <div key={idx} className="text-slate-300 flex items-center justify-between">
                    <span className="text-purple-300">{stack.frame}</span>
                    <span className="text-slate-500">{stack.file}:{stack.line}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Memory Footprint Footer */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Debug Memory Heap:</span>
            <span className="text-cyan-400 font-bold">{debuggerSession.memoryAllocatedMb} MB</span>
          </div>
        </div>
      </div>
    </div>
  );
};
