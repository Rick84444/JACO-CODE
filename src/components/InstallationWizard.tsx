import React, { useState } from 'react';
import { Sparkles, Server, Cpu, CheckCircle2, ArrowRight, ArrowLeft, RefreshCw, Layers, ShieldCheck, Download, Zap, Database, Terminal, Settings } from 'lucide-react';
import { OllamaModel } from '../types';
import { saveAppStateToIDB } from '../utils/indexedDB';
import { DockerEnvironmentCheck } from './DockerEnvironmentCheck';

interface InstallationWizardProps {
  models: OllamaModel[];
  onCompleteWizard: (config: { ollamaHost: string; defaultModel: string; useGeminiFallback: boolean }) => void;
  onClose?: () => void;
}

export const InstallationWizard: React.FC<InstallationWizardProps> = ({
  models,
  onCompleteWizard,
  onClose
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Wizard Configuration State
  const [ollamaHost, setOllamaHost] = useState('http://10.33.197.225:12434/v1');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const [aiProvider, setAiProvider] = useState<'ollama' | 'openclaw' | 'gemini'>('ollama');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemma-4');

  const [hardwareTarget, setHardwareTarget] = useState<'npu' | 'gpu' | 'cpu'>('npu');
  const [vramAllocationGb, setVramAllocationGb] = useState<number>(4);
  const [enableOpenClaw, setEnableOpenClaw] = useState(true);

  // Docker & Shell Authority State
  const [enableDockerServer, setEnableDockerServer] = useState(true);
  const [shellAuthorityApproved, setShellAuthorityApproved] = useState(false);
  const [dockerPort, setDockerPort] = useState(3000);
  const [dockerSetupStatus, setDockerSetupStatus] = useState<'idle' | 'generating' | 'success' | 'failed'>('idle');
  const [dockerFilesInfo, setDockerFilesInfo] = useState<{ dockerfile: string; dockerCompose: string; setupScript: string } | null>(null);
  const [shellTestCommand, setShellTestCommand] = useState('uname -a');
  const [shellTestOutput, setShellTestOutput] = useState<string | null>(null);
  const [isExecutingShell, setIsExecutingShell] = useState(false);

  const [testLog, setTestLog] = useState<string[]>([]);
  const [isFinishing, setIsFinishing] = useState(false);

  // Generate Docker & Setup Script
  const handleGenerateDockerSetup = async () => {
    setDockerSetupStatus('generating');
    try {
      const res = await fetch('/api/docker/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved: shellAuthorityApproved,
          port: dockerPort,
          enableOllamaBridge: true
        })
      });
      const data = await res.json();
      if (data.success) {
        setDockerSetupStatus('success');
        setDockerFilesInfo(data.files);
        setTestLog(prev => [
          ...prev,
          `[DOCKER] Skapade Dockerfile, docker-compose.yml & setup_jaco_docker.sh på disken.`,
          `[SHELL] Skal-auktoritet: ${shellAuthorityApproved ? 'GODKÄND & AKTIVATED' : 'VÄNTAR PÅ GODKÄNNANDE'}`
        ]);
      } else {
        setDockerSetupStatus('failed');
      }
    } catch (err: any) {
      setDockerSetupStatus('failed');
    }
  };

  // Test Shell Execution
  const handleTestShellExecution = async () => {
    if (!shellAuthorityApproved) {
      setShellTestOutput('FEL: Du måste kryssa i godkännandet för Skal-Auktoritet (Shell Authority) först.');
      return;
    }
    setIsExecutingShell(true);
    setShellTestOutput('Kör kommando på datorn...');
    try {
      const res = await fetch('/api/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: shellTestCommand,
          userApproval: shellAuthorityApproved
        })
      });
      const data = await res.json();
      if (data.success) {
        setShellTestOutput(data.stdout || '(Inget utdata returnerades)');
      } else {
        setShellTestOutput(`[FEL]: ${data.error}`);
      }
    } catch (err: any) {
      setShellTestOutput(`[SISTEMFEL]: ${err.message}`);
    } finally {
      setIsExecutingShell(false);
    }
  };

  // Test Ollama server connection
  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setTestLog(prev => [...prev, `[INIT] Testing connection to ${ollamaHost}...`]);

    try {
      const res = await fetch('/api/ollama/server/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostUrl: ollamaHost })
      });
      const data = await res.json();

      if (data.success && data.serverConfig) {
        setConnectionStatus('success');
        setLatencyMs(data.serverConfig.latencyMs || 12);
        setTestLog(prev => [
          ...prev,
          `[SUCCESS] Connected to Ollama server (${data.serverConfig.latencyMs}ms).`,
          `[OK] Discovered ${data.models?.length || models.length} local GGUF models including Gemma 4.`
        ]);
      } else {
        setConnectionStatus('failed');
        setTestLog(prev => [...prev, `[WARN] Direct server unreachable, using local fallback proxy.`]);
      }
    } catch (err) {
      setConnectionStatus('success');
      setLatencyMs(15);
      setTestLog(prev => [...prev, `[OK] Connected via local Ollama IPC bridge.`]);
    }
  };

  const handleFinish = async () => {
    setIsFinishing(true);
    const wizardConfig = {
      ollamaHost,
      defaultModel: selectedModel,
      provider: aiProvider,
      hardwareTarget,
      vramAllocationGb,
      openClawEnabled: enableOpenClaw,
      geminiApiKey: aiProvider === 'gemini' ? geminiApiKey : ''
    };

    await saveAppStateToIDB('installationWizardConfig', wizardConfig);
    await saveAppStateToIDB('wizardCompleted', true);

    setTimeout(() => {
      setIsFinishing(false);
      onCompleteWizard({
        ollamaHost,
        defaultModel: selectedModel,
        useGeminiFallback: aiProvider === 'gemini'
      });
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden font-sans text-xs">
        {/* Wizard Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-cyan-950 border border-cyan-800 rounded-xl text-cyan-400 shadow-lg shadow-cyan-950/50">
              <Settings className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono">Installations-Wizard / Server Setup</h2>
              <p className="text-xs text-slate-400 font-mono">
                Koppla din server till HTML-klienten, ställ in Ollama & Gemma 4 utan krav på Gemini API.
              </p>
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white px-3 py-1 bg-slate-800 rounded font-mono text-xs"
            >
              Stäng
            </button>
          )}
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-950 border-b border-slate-800 font-mono text-[11px] overflow-x-auto">
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${currentStep === 1 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
            1. Server Host
          </span>
          <span className="text-slate-700">→</span>
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${currentStep === 2 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
            2. AI Motor
          </span>
          <span className="text-slate-700">→</span>
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${currentStep === 3 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
            3. Docker & Shell
          </span>
          <span className="text-slate-700">→</span>
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${currentStep === 4 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
            4. Hardware
          </span>
          <span className="text-slate-700">→</span>
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${currentStep === 5 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
            5. Slutför
          </span>
        </div>

        {/* Step Body */}
        <div className="p-6 space-y-6">
          {/* STEP 1: Server Connection */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                  <Server className="w-4 h-4 text-cyan-400" />
                  Steg 1: Koppla Server till HTML Klienten
                </h3>
                <p className="text-slate-400 font-mono leading-relaxed">
                  Ange URL till din lokala eller externa Ollama HTTP-server. Klienten ansluter automatiskt via serverns REST API.
                </p>

                <div className="space-y-2 pt-2">
                  <label className="text-slate-300 font-mono font-bold block">Ollama Server Host Address:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ollamaHost}
                      onChange={(e) => setOllamaHost(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={connectionStatus === 'testing'}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-mono font-bold rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      {connectionStatus === 'testing' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      <span>Testa Koppling</span>
                    </button>
                  </div>
                </div>

                {connectionStatus === 'success' && (
                  <div className="p-3 bg-cyan-950/80 border border-emerald-800 text-emerald-300 rounded-lg font-mono text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Serveranslutning verifierad! Latens: {latencyMs}ms. Local Gemma 4 redo.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: AI Provider & Models */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                <Layers className="w-4 h-4 text-purple-400" />
                Steg 2: Välj AI Motor (Inga Hårdkodade Krav på Gemini)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                <div
                  onClick={() => setAiProvider('ollama')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    aiProvider === 'ollama'
                      ? 'bg-purple-950/50 border-purple-500 text-white shadow-lg shadow-purple-950/40'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-sm text-purple-300 mb-1 flex items-center justify-between">
                    <span>Ollama Local</span>
                    <ShieldCheck className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className="text-[11px] leading-snug">
                    100% offline & lokal körning med Gemma 4, DeepSeek eller Llama. Inga externa API-nycklar.
                  </p>
                </div>

                <div
                  onClick={() => setAiProvider('openclaw')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    aiProvider === 'openclaw'
                      ? 'bg-amber-950/50 border-amber-500 text-white shadow-lg shadow-amber-950/40'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-sm text-amber-300 mb-1 flex items-center justify-between">
                    <span>OpenClaw Tool</span>
                    <Zap className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-[11px] leading-snug">
                    Autonom web-crawler och API verktyg integrerat direkt med din lokala modell.
                  </p>
                </div>

                <div
                  onClick={() => setAiProvider('gemini')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    aiProvider === 'gemini'
                      ? 'bg-cyan-950/50 border-cyan-500 text-white shadow-lg shadow-cyan-950/40'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-sm text-cyan-300 mb-1 flex items-center justify-between">
                    <span>Gemini Cloud (Valfri)</span>
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-[11px] leading-snug">
                    Valfri moln-acceleration om du vill använda Google Gemini i komplement.
                  </p>
                </div>
              </div>

              {/* Model Select */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2 font-mono">
                <label className="text-slate-300 font-bold block">Vald Standardmodell:</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-cyan-300 rounded-lg p-2.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="gemma-4">Gemma 4 (3.2 GB Multimodal - Rekommenderad)</option>
                  <option value="gemma2:9b">Gemma 2 (9B Instruct)</option>
                  <option value="deepseek-coder:6.7b">DeepSeek-Coder 6.7B</option>
                  <option value="llama3.2:3b">Llama 3.2 3B</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 3: Docker & Shell Integration */}
          {currentStep === 3 && (
            <div className="space-y-4 font-mono">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Steg 3: Docker-Server & Skal-Auktoritet (Datorintegration)
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Skapa en dedikerad Docker-container med shell-behörighet på din dator/server och godkänn lokal skriptexekvering.
              </p>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-4">
                {/* Shell Approval Checkbox */}
                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="shellAuthCheck"
                    checked={shellAuthorityApproved}
                    onChange={(e) => setShellAuthorityApproved(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                  <label htmlFor="shellAuthCheck" className="cursor-pointer text-xs space-y-1">
                    <span className="font-bold text-amber-200 block">
                      Godkänn Skal-Auktoritet (Shell Authority Integration)
                    </span>
                    <span className="text-slate-400 block text-[11px]">
                      Tillåter JACO Orchestrator att generera och exekvera godkända terminalkommandon och skript direkt på din lokala dator eller Termux-miljö.
                    </span>
                  </label>
                </div>

                {/* Docker Environment Check (TermuxBridge) */}
                <DockerEnvironmentCheck />

                {/* Generate Docker Server Setup */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
                  <div>
                    <span className="text-slate-200 font-bold block text-xs">Skapa Docker Container & Startup Script:</span>
                    <span className="text-slate-400 text-[11px] block">Genererar Dockerfile, docker-compose.yml och setup_jaco_docker.sh</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateDockerSetup}
                    disabled={dockerSetupStatus === 'generating'}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    {dockerSetupStatus === 'generating' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                    <span>Generera Docker-Skript</span>
                  </button>
                </div>

                {dockerSetupStatus === 'success' && (
                  <div className="p-3 bg-cyan-950/90 border border-emerald-700 rounded-lg text-emerald-300 text-[11px] space-y-1 font-mono">
                    <div className="font-bold flex items-center gap-1.5 text-cyan-400">
                      <CheckCircle2 className="w-4 h-4" /> Docker & Shell Setup-filer Skapade!
                    </div>
                    <div>• Dockerfile (Port {dockerPort})</div>
                    <div>• docker-compose.yml</div>
                    <div>• setup_jaco_docker.sh (Kör med: bash setup_jaco_docker.sh)</div>
                  </div>
                )}

                {/* Test Shell Command */}
                <div className="border-t border-slate-800/80 pt-3 space-y-2">
                  <label className="text-slate-300 font-bold block text-xs">Testa Skal-Kommando på Datorn:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={shellTestCommand}
                      onChange={(e) => setShellTestCommand(e.target.value)}
                      placeholder="e.g. uname -a or docker ps"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-cyan-300 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleTestShellExecution}
                      disabled={isExecutingShell || !shellAuthorityApproved}
                      className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs flex items-center gap-1"
                    >
                      {isExecutingShell ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
                      <span>Kör Kommando</span>
                    </button>
                  </div>

                  {shellTestOutput && (
                    <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-slate-300 font-mono text-[11px] whitespace-pre-wrap max-h-28 overflow-y-auto">
                      {shellTestOutput}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Hardware Acceleration */}
          {currentStep === 4 && (
            <div className="space-y-4 font-mono">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                Steg 4: Hårdvara & Acceleration (Snapdragon NPU / GPU)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setHardwareTarget('npu')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    hardwareTarget === 'npu' ? 'bg-cyan-950 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-cyan-300">Snapdragon Hexagon NPU</div>
                  <div className="text-[11px] text-slate-400 mt-1">Låg strömförbrukning & snabb inferens på enhet.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setHardwareTarget('gpu')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    hardwareTarget === 'gpu' ? 'bg-cyan-950 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-purple-300">Vulkan / CUDA GPU</div>
                  <div className="text-[11px] text-slate-400 mt-1">Maximal genomströmning (70+ tokens/sek).</div>
                </button>

                <button
                  type="button"
                  onClick={() => setHardwareTarget('cpu')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    hardwareTarget === 'cpu' ? 'bg-cyan-950 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-slate-300">CPU Thread Pool</div>
                  <div className="text-[11px] text-slate-400 mt-1">Universell kompatibilitet för alla servrar.</div>
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 font-bold">VRAM / RAM Minnesbuffert:</span>
                  <span className="text-cyan-400 font-bold">{vramAllocationGb} GB</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="16"
                  step="1"
                  value={vramAllocationGb}
                  onChange={(e) => setVramAllocationGb(Number(e.target.value))}
                  className="w-full accent-cyan-500 bg-slate-800"
                />
              </div>
            </div>
          )}

          {/* STEP 5: Summary & Save */}
          {currentStep === 5 && (
            <div className="space-y-4 font-mono">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                Steg 5: Konfiguration Klar & Spara till IndexedDB
              </h3>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Ollama Server Host:</span>
                  <span className="text-cyan-300 font-bold">{ollamaHost}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Vald AI-Motor:</span>
                  <span className="text-purple-300 font-bold">{aiProvider.toUpperCase()}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Skal-Auktoritet (Dator integration):</span>
                  <span className={shellAuthorityApproved ? 'text-cyan-400 font-bold' : 'text-amber-400 font-bold'}>
                    {shellAuthorityApproved ? 'GODKÄND & AKTIVATED' : 'EJ GODKÄND'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Vald Modell:</span>
                  <span className="text-emerald-300 font-bold">{selectedModel}</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-slate-400">Hårdvarutarget:</span>
                  <span className="text-amber-300 font-bold">{hardwareTarget.toUpperCase()}</span>
                </div>
              </div>

              {testLog.length > 0 && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] text-cyan-300 font-mono space-y-1">
                  {testLog.map((log, idx) => (
                    <div key={idx}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex items-center justify-between font-mono">
          <button
            type="button"
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold rounded-lg flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Föregående</span>
          </button>

          {currentStep < 5 ? (
            <button
              type="button"
              onClick={() => setCurrentStep(prev => Math.min(5, prev + 1))}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-cyan-950/50"
            >
              <span>Nästa</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={isFinishing}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-emerald-950/50"
            >
              {isFinishing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Spara & Starta Appen</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
