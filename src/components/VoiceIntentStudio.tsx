import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Radio, Sparkles, CheckCircle2, Play, Cpu, ArrowRight, ShieldCheck, Terminal, Code2, AlertTriangle, FileCode, Volume2, VolumeX, Settings, Sliders, AudioWaveform } from 'lucide-react';
import { VoiceCommandIntent, AgenticStep, IntentCategory, CodeFile } from '../types';
import { speakAura, stopAuraSpeech, getAuraVoiceSettings, saveAuraVoiceSettings, AuraVoiceSettings } from '../utils/auraVoiceService';

interface VoiceIntentStudioProps {
  isRecordingVoice: boolean;
  onToggleVoice: () => void;
  onParseVoiceIntent: (command: string) => void;
  currentIntent: VoiceCommandIntent | null;
  proposedSteps: AgenticStep[];
  onExecuteWorkflow: () => void;
  isExecutingWorkflow: boolean;
  codeFiles: CodeFile[];
  activeFilePath: string;
}

const PRESET_COMMANDS = [
  "Refactor tensor dot product in math.ts to support NPU batching",
  "Debug null pointer exception in server.ts voice agent handler",
  "Run Vitest unit tests for NPU math calculations",
  "Sync code diff to VS Code Antigravity plugin via Wi-Fi socket",
  "Add L2 Vector Norm calculation function to math.ts"
];

export const VoiceIntentStudio: React.FC<VoiceIntentStudioProps> = ({
  isRecordingVoice,
  onToggleVoice,
  onParseVoiceIntent,
  currentIntent,
  proposedSteps,
  onExecuteWorkflow,
  isExecutingWorkflow,
  codeFiles,
  activeFilePath
}) => {
  const [customSpeechText, setCustomSpeechText] = useState('');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [voiceSettings, setVoiceSettings] = useState<AuraVoiceSettings>(getAuraVoiceSettings());
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [testSpeechText, setTestSpeechText] = useState('Hej! Jag är Agent Aura. Alla autonoma system, A2A-konton och röstsyntesmoduler är verifierade och redo.');

  const updateSetting = <K extends keyof AuraVoiceSettings>(key: K, value: AuraVoiceSettings[K]) => {
    const updated = saveAuraVoiceSettings({ [key]: value });
    setVoiceSettings(updated);
  };

  const handleTestSpeech = async () => {
    if (isSpeaking) {
      stopAuraSpeech();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    await speakAura(testSpeechText, {
      voicePreset: voiceSettings.voicePreset,
      pitch: voiceSettings.pitch,
      rate: voiceSettings.rate,
      volume: voiceSettings.volume,
      lang: voiceSettings.language,
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false)
    });
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSpeechText.trim()) return;
    onParseVoiceIntent(customSpeechText.trim());
  };

  const handlePresetClick = (cmd: string) => {
    setCustomSpeechText(cmd);
    onParseVoiceIntent(cmd);
  };

  useEffect(() => {
    if (isExecutingWorkflow) {
      setCompletedSteps([]);
      const stepIds = proposedSteps.map(s => s.id);
      stepIds.forEach((id, index) => {
        setTimeout(() => {
          setCompletedSteps(prev => [...prev, id]);
        }, (index + 1) * 600);
      });
    }
  }, [isExecutingWorkflow, proposedSteps]);

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      {/* Voice Control & Waveform Studio Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left flex-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-950 text-purple-300 border border-purple-800 rounded-full text-xs font-mono font-semibold">
              <Radio className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>Qualcomm Hexagon Voice Neural Processing</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Real-Time Voice Intent Recognition
            </h2>
            <p className="text-xs text-slate-400 max-w-xl">
              Speak coding instructions directly into your phone. The on-device LLM parses real-time intent, extracts AST file targets, and builds an agentic execution plan.
            </p>
          </div>

          {/* Large Animated Microphone Record Trigger */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onToggleVoice}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                isRecordingVoice
                  ? 'bg-rose-600 text-white shadow-rose-600/50 ring-4 ring-rose-500/40 animate-pulse scale-105'
                  : 'bg-gradient-to-tr from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-600/30 hover:scale-105'
              }`}
            >
              {isRecordingVoice ? (
                <Mic className="w-10 h-10 animate-bounce" />
              ) : (
                <Mic className="w-10 h-10" />
              )}
            </button>
            <span className="text-xs font-mono font-semibold text-slate-300">
              {isRecordingVoice ? 'Listening voice waveform...' : 'Tap to Speak'}
            </span>
          </div>
        </div>

        {/* Live Audio Waveform Simulation */}
        {isRecordingVoice && (
          <div className="mt-6 p-4 bg-slate-950/80 rounded-xl border border-rose-900/60 flex items-center justify-center gap-1 h-16">
            {[40, 75, 30, 90, 60, 100, 45, 80, 20, 85, 95, 50, 70, 30, 80, 100, 65, 40].map((h, idx) => (
              <div
                key={idx}
                className="w-1.5 bg-gradient-to-t from-rose-500 to-cyan-400 rounded-full animate-pulse transition-all"
                style={{
                  height: `${Math.min(100, h * (Math.random() * 0.5 + 0.7))}%`,
                  animationDelay: `${idx * 0.05}s`
                }}
              />
            ))}
          </div>
        )}

        {/* Manual Speech Input / Prompt Form */}
        <div className="mt-6 pt-4 border-t border-slate-800">
          <form onSubmit={handleCustomSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={customSpeechText}
                onChange={(e) => setCustomSpeechText(e.target.value)}
                placeholder="Or type voice command e.g. 'Refactor math.ts for NPU vector dot product'"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3.5 pr-10 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <Sparkles className="w-4 h-4 text-cyan-400 absolute right-3 top-2.5 pointer-events-none" />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              Parse Intent
            </button>
          </form>

          {/* Quick Preset Voice Command Chips */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-mono text-slate-500 mr-1">Voice Presets:</span>
            {PRESET_COMMANDS.map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => handlePresetClick(cmd)}
                className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md text-[11px] font-mono transition-colors border border-slate-700/60"
              >
                "{cmd.slice(0, 32)}..."
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Aura Voice Engine & Text-to-Speech Studio */}
      <div className="bg-slate-900 border border-purple-500/40 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <AudioWaveform className="w-5 h-5 text-purple-400" />
            <div>
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <span>Aura Voice Engine & Speech Synthesis</span>
                <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded font-mono font-bold">[TTS & AUDIO SYNTH]</span>
              </h3>
              <p className="text-[11px] text-slate-400">Konfigurera röstprofiler, tonhöjd, hastighet och testa röståterkoppling direkt från Agent Aura.</p>
            </div>
          </div>

          <button
            onClick={handleTestSpeech}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 shadow-md ${
              isSpeaking
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950 animate-pulse'
                : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-950'
            }`}
          >
            {isSpeaking ? (
              <>
                <VolumeX className="w-4 h-4" />
                <span>Stoppa Röståterkoppling</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4" />
                <span>Testa Aura Röstsyntes</span>
              </>
            )}
          </button>
        </div>

        {/* Live Audio Speech Waveform Visualizer */}
        {isSpeaking && (
          <div className="p-3 bg-purple-950/60 border border-purple-800/80 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AudioWaveform className="w-5 h-5 text-purple-300 animate-pulse" />
              <span className="text-xs font-mono font-bold text-purple-200">Aura läser upp texten...</span>
            </div>
            <div className="flex items-center gap-1 h-6">
              {[60, 90, 40, 100, 70, 85, 50, 95, 30, 80, 100, 40].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-purple-400 rounded-full animate-pulse"
                  style={{
                    height: `${h}%`,
                    animationDelay: `${i * 0.08}s`
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Voice Preset Selector */}
          <div className="space-y-1 bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <label className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
              <Settings className="w-3.5 h-3.5 text-purple-400" /> Röstprofil (Preset)
            </label>
            <select
              value={voiceSettings.voicePreset}
              onChange={(e) => updateSetting('voicePreset', e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-purple-300 font-mono focus:outline-none focus:border-purple-500 text-xs"
            >
              <option value="aura-swedish-neural">Aura Sovereign (Svenska Neural)</option>
              <option value="aura-swedish-studio">Aura Studio (Svenska Warm)</option>
              <option value="aura-english-hexagon">Aura Hexagon (Engelska EN)</option>
              <option value="aura-english-sovereign">Aura Sovereign (Engelska US)</option>
            </select>
          </div>

          {/* Rate & Pitch Sliders */}
          <div className="space-y-2 bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400 font-bold flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Hastighet (Rate)
              </span>
              <span className="text-cyan-300 font-mono font-bold">{voiceSettings.rate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={voiceSettings.rate}
              onChange={(e) => updateSetting('rate', parseFloat(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />

            <div className="flex justify-between items-center text-[11px] pt-1">
              <span className="text-slate-400 font-bold flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-amber-400" /> Tonhöjd (Pitch)
              </span>
              <span className="text-amber-300 font-mono font-bold">{voiceSettings.pitch.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={voiceSettings.pitch}
              onChange={(e) => updateSetting('pitch', parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
          </div>

          {/* Test Text Prompt Input */}
          <div className="space-y-1 bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <label className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Testmeddelande för Uppläsning
            </label>
            <textarea
              rows={3}
              value={testSpeechText}
              onChange={(e) => setTestSpeechText(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 text-xs font-mono resize-none"
            />
          </div>
        </div>
      </div>

      {/* Recognized Intent Result Card */}
      {currentIntent && (
        <div className="bg-slate-900 border border-cyan-800/80 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <span className="text-xs font-mono text-slate-400">Recognized Speech Transcript:</span>
              <h3 className="text-base font-bold text-cyan-300 font-mono mt-0.5">
                "{currentIntent.originalSpeech}"
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-purple-950 text-purple-300 border border-purple-800 rounded-full text-xs font-mono font-bold">
                Category: {currentIntent.parsedIntentCategory}
              </span>
              <span className="px-3 py-1 bg-cyan-950 text-emerald-300 border border-emerald-800 rounded-full text-xs font-mono font-bold">
                {Math.round(currentIntent.confidence * 100)}% Confidence
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
              <span className="text-slate-500 block">Target Workspace File:</span>
              <div className="text-white font-semibold flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>{currentIntent.targetFile}</span>
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
              <span className="text-slate-500 block">Intent High-Level Summary:</span>
              <p className="text-slate-300">{currentIntent.summary}</p>
            </div>
          </div>

          {/* Action Items */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
              Antigravity Action Items
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {currentIntent.actionItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-slate-300 font-mono">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Execution Steps */}
          {proposedSteps.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-400" /> Agentic Execution Cycle Plan
                </h4>

                <button
                  onClick={onExecuteWorkflow}
                  disabled={isExecutingWorkflow}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-mono text-xs font-bold rounded-lg shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${isExecutingWorkflow ? 'animate-spin' : ''}`} />
                  <span>{isExecutingWorkflow ? 'Executing Agent Steps...' : 'Execute Agent Workflow'}</span>
                </button>
              </div>

              <div className="space-y-2">
                {proposedSteps.map((step, idx) => {
                  const isDone = completedSteps.includes(step.id);
                  return (
                    <div
                      key={step.id}
                      className={`p-3 rounded-lg border font-mono text-xs transition-all flex items-start gap-3 ${
                        isDone
                          ? 'bg-cyan-950/40 border-emerald-800 text-slate-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                        isDone ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h5 className={`font-bold ${isDone ? 'text-emerald-300' : 'text-slate-300'}`}>
                            {step.title}
                          </h5>
                          <span className="text-[10px] uppercase text-slate-500">{step.type}</span>
                        </div>
                        <p className="text-slate-400 text-[11px] mt-0.5">{step.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
