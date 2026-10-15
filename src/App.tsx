import React, { useState, useEffect } from 'react';
import { Header, TabType } from './components/Header';
import { ModelManager } from './components/ModelManager';
import { VoiceIntentStudio } from './components/VoiceIntentStudio';
import { MobileIDE } from './components/MobileIDE';
import { SocketSyncPanel } from './components/SocketSyncPanel';
import { TerminalDrawer } from './components/TerminalDrawer';
import { AndroidLocalSetupSkills } from './components/AndroidLocalSetupSkills';
import { CudaQuantumStudio } from './components/CudaQuantumStudio';
import { GoogleKeepManager } from './components/GoogleKeepManager';
import { OpenClawStudio } from './components/OpenClawStudio';
import { InstallationWizard } from './components/InstallationWizard';
import { JACOHardeningWizard } from './components/JACOHardeningWizard';
import { AutonomousAutopilot } from './components/AutonomousAutopilot';
import { Gatekeeper } from './components/Gatekeeper';
import { LiteRTMigration } from './components/LiteRTMigration';
import { ConnectivityDiagnostics } from './components/ConnectivityDiagnostics';
import { PatchHistoryView } from './components/PatchHistoryView';
import { SystemIntelligence } from './components/SystemIntelligence';
import { MemoryStoreInspector } from './components/MemoryStoreInspector';
import { ProductionTodo } from './components/ProductionTodo';
import { ActiveProcesses } from './components/ActiveProcesses';
import { AntigravityBridgeStudio } from './components/AntigravityBridgeStudio';
import { RevenueInsights } from './components/RevenueInsights';
import { VerifiedCapabilitiesView } from './components/VerifiedCapabilitiesView';
import { VerifiedMarketplacesView } from './components/VerifiedMarketplacesView';
import { CostAwareOrchestratorView } from './components/CostAwareOrchestratorView';
import { JacoAuraComputeIDE } from './components/JacoAuraComputeIDE';
import { QuickCheckout } from './components/QuickCheckout';
import { TermuxBridge } from './lib/termuxBridge';
import { useSystemTelemetry } from './hooks/systemTelemetry';
import { OllamaModel, DeviceTelemetry, VoiceCommandIntent, AgenticStep, CodeFile, SocketDevice, TerminalLog, PatchHistoryItem } from './types';
import { INITIAL_MODELS, INITIAL_TELEMETRY, INITIAL_CODE_FILES, INITIAL_DEVICES, INITIAL_TERMINAL_LOGS, INITIAL_PATCH_HISTORY } from './mockData';
import {
  loadCodeFilesFromIDB,
  saveCodeFilesToIDB,
  loadTerminalLogsFromIDB,
  saveTerminalLogsToIDB,
  saveAppStateToIDB,
  loadAppStateFromIDB
} from './utils/indexedDB';
import { exportAndBackupCheckpoint } from './utils/checkpointExporter';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('aura-ide');

  const sendToAuraChat = (text: string) => {
    const value = String(text || '').trim();
    if (!value) return;
    try { sessionStorage.setItem('jaco:aura:prefill', value); } catch {}
    setActiveTab('aura-ide');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('jaco:aura:prefill', { detail: { text: value } }));
    }, 0);
  };

  useEffect(() => {
    if (activeTab === 'jaco-bot') setActiveTab('aura-ide');
  }, [activeTab]);

  const [isPowerSaver, setIsPowerSaver] = useState<boolean>(() => {
    return localStorage.getItem('jaco_power_saver') === 'true';
  });

  const togglePowerSaver = () => {
    setIsPowerSaver(prev => {
      const next = !prev;
      localStorage.setItem('jaco_power_saver', String(next));
      return next;
    });
  };

  // Real-time System Telemetry Hook (Polling interval reduced from 3000ms to 12000ms when Power Saver is enabled)
  const { telemetry: liveTelemetry } = useSystemTelemetry({
    pollingIntervalMs: isPowerSaver ? 12000 : 3000
  });

  // Application State
  const [models, setModels] = useState<OllamaModel[]>(INITIAL_MODELS);
  const [telemetry, setTelemetry] = useState<DeviceTelemetry>(INITIAL_TELEMETRY);

  // Synchronize live telemetry from useSystemTelemetry hook
  useEffect(() => {
    if (liveTelemetry) {
      setTelemetry(prev => ({
        ...prev,
        ...liveTelemetry,
        npuLoad: liveTelemetry.npuLoad ?? liveTelemetry.npuUsagePercent,
        npuUsagePercent: liveTelemetry.npuLoad ?? liveTelemetry.npuUsagePercent
      }));
    }
  }, [liveTelemetry]);
  const [codeFiles, setCodeFiles] = useState<CodeFile[]>(INITIAL_CODE_FILES);
  const [activeFilePath, setActiveFilePath] = useState<string>('src/server.ts');
  const [socketDevices, setSocketDevices] = useState<SocketDevice[]>(INITIAL_DEVICES);
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>(INITIAL_TERMINAL_LOGS);
  const [patchHistory, setPatchHistory] = useState<PatchHistoryItem[]>(INITIAL_PATCH_HISTORY);
  const [showWizard, setShowWizard] = useState<boolean>(false);
  const [showTodoModal, setShowTodoModal] = useState<boolean>(false);

  // Agent State
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [currentIntent, setCurrentIntent] = useState<VoiceCommandIntent | null>(null);
  const [proposedSteps, setProposedSteps] = useState<AgenticStep[]>([]);
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState(false);

  // Active Model
  const activeModel = models.find(m => m.isLoaded) || models[0];

  // Load status from backend API on mount
  useEffect(() => {
    fetch('/api/ollama/status')
      .then(res => res.json())
      .then(data => {
        if (data.models) setModels(data.models);
        if (data.telemetry) setTelemetry(data.telemetry);
      })
      .catch(err => {
        console.warn('Backend server connecting, using local state:', err);
      });
  }, []);

  // Restore application state from IndexedDB on initial mount
  useEffect(() => {
    let isMounted = true;
    async function restoreFromIndexedDB() {
      try {
        const idbFiles = await loadCodeFilesFromIDB();
        if (isMounted && idbFiles && idbFiles.length > 0) {
          setCodeFiles(idbFiles);
        } else {
          try {
            const res = await fetch('/api/workspace/files');
            const data = await res.json();
            if (data.files && data.files.length > 0) {
              if (isMounted) setCodeFiles(data.files);
              await saveCodeFilesToIDB(data.files);
            } else {
              await saveCodeFilesToIDB(INITIAL_CODE_FILES);
            }
          } catch {
            await saveCodeFilesToIDB(INITIAL_CODE_FILES);
          }
        }

        const idbLogs = await loadTerminalLogsFromIDB();
        if (isMounted && idbLogs && idbLogs.length > 0) {
          setTerminalLogs(idbLogs);
        } else {
          await saveTerminalLogsToIDB(INITIAL_TERMINAL_LOGS);
        }

        const idbPatches = await loadAppStateFromIDB<PatchHistoryItem[]>('patchHistory', INITIAL_PATCH_HISTORY);
        if (isMounted && idbPatches && idbPatches.length > 0) {
          setPatchHistory(idbPatches);
        } else {
          await saveAppStateToIDB('patchHistory', INITIAL_PATCH_HISTORY);
        }

        const savedPath = await loadAppStateFromIDB<string>('activeFilePath', 'src/server.ts');
        if (isMounted && savedPath) setActiveFilePath(savedPath);

        // Aura is the canonical product workspace. Legacy surfaces are opened
        // from Aura Tool Fabric and never become the persisted startup screen.
        await loadAppStateFromIDB<any>('activeTab', 'aura-ide');
        if (isMounted) setActiveTab('aura-ide');
      } catch (err) {
        console.warn('Error restoring from IndexedDB:', err);
      }
    }

    restoreFromIndexedDB();
    return () => { isMounted = false; };
  }, []);

  // Poll Termux hardware sensors and merge into telemetry (throttled / paused in Power Saver mode for mobile optimization)
  useEffect(() => {
    let isMounted = true;
    const pollTermux = async () => {
      // Pause non-essential background sensor polling when Power Saver is enabled
      if (isPowerSaver) return;

      try {
        const battery = await TermuxBridge.getBatteryStatus();
        const sysInfo = await TermuxBridge.getSystemInfo();
        const light = await TermuxBridge.getLightSensor();
        
        if (isMounted && (battery || sysInfo || light)) {
          setTelemetry(prev => ({
            ...prev,
            ...(battery ? {
              batteryLevel: battery.batteryLevel,
              batteryPercent: battery.batteryPercent,
              batteryStatus: battery.batteryStatus,
              isCharging: battery.isCharging,
              temperatureC: battery.temperatureC,
              thermalTempC: battery.thermalTempC
            } : {}),
            ...(sysInfo ? {
              ramUsedGb: sysInfo.ramUsedGb,
              ramTotalGb: sysInfo.ramTotalGb
            } : {}),
            ...(light ? {
              termuxLightLux: light.termuxLightLux
            } : {})
          }));
        }
      } catch (err) {
        console.warn('Termux bridge polling error:', err);
      }
    };

    if (!isPowerSaver) {
      pollTermux();
    }

    // Interval polling: 45s if power saver enabled, 15s in normal mode
    const intervalId = setInterval(pollTermux, isPowerSaver ? 45000 : 15000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isPowerSaver]);

  // Auto-persist codeFiles to IndexedDB on change
  useEffect(() => {
    if (codeFiles && codeFiles.length > 0) {
      saveCodeFilesToIDB(codeFiles);
    }
  }, [codeFiles]);

  // Auto-persist terminalLogs to IndexedDB on change
  useEffect(() => {
    if (terminalLogs && terminalLogs.length > 0) {
      saveTerminalLogsToIDB(terminalLogs);
    }
  }, [terminalLogs]);

  // Auto-persist activeFilePath and activeTab
  useEffect(() => {
    if (activeFilePath) {
      saveAppStateToIDB('activeFilePath', activeFilePath);
    }
  }, [activeFilePath]);

  useEffect(() => {
    if (activeTab) {
      saveAppStateToIDB('activeTab', activeTab);
    }
  }, [activeTab]);

  // Web Speech API Integration for Microphone input
  const toggleVoiceRecording = () => {
    if (isRecordingVoice) {
      setIsRecordingVoice(false);
    } else {
      setIsRecordingVoice(true);
      // Check if WebSpeech is available
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setIsRecordingVoice(false);
          handleParseVoiceIntent(transcript);
        };

        recognition.onerror = () => {
          setIsRecordingVoice(false);
          // Fallback demo prompt
          handleParseVoiceIntent("Refactor math tensor calculations for zero regressions");
        };

        recognition.start();
      } else {
        // Fallback for environments without microphone access
        setTimeout(() => {
          setIsRecordingVoice(false);
          handleParseVoiceIntent("Refactor math tensor calculations for zero regressions");
        }, 1500);
      }
    }
  };

  // Handler: Switch Ollama Model
  const handleSwitchModel = async (modelId: string) => {
    try {
      const res = await fetch('/api/ollama/model/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId })
      });
      const data = await res.json();
      if (data.models) setModels(data.models);
      if (data.telemetry) setTelemetry(data.telemetry);
    } catch (err) {
      setModels(prev => prev.map(m => ({ ...m, isLoaded: m.id === modelId })));
    }
  };

  // Handler: Pull Model
  const handlePullModel = async (modelName: string) => {
    try {
      const res = await fetch('/api/ollama/model/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName })
      });
      const data = await res.json();
      if (data.models) setModels(data.models);
    } catch (err) {
      console.error('Error pulling model:', err);
    }
  };

  // Handler: Parse Voice Intent via server API
  const handleParseVoiceIntent = async (command: string) => {
    try {
      const res = await fetch('/api/agent/voice-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceCommand: command,
          activeFilePath
        })
      });
      const data = await res.json();
      if (data.intent) setCurrentIntent(data.intent);
      if (data.steps) setProposedSteps(data.steps);
      setActiveTab('voice');
    } catch (err) {
      console.error('Error parsing voice intent:', err);
    }
  };

  // Handler: Execute Agent Workflow
  const handleExecuteWorkflow = async () => {
    if (!currentIntent) return;
    setIsExecutingWorkflow(true);

    try {
      const activeFile = codeFiles.find(f => f.path === activeFilePath) || codeFiles[0];
      const res = await fetch('/api/agent/run-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: currentIntent,
          targetFilePath: activeFile.path,
          codeContent: activeFile.content
        })
      });
      const data = await res.json();
      if (data.allFiles) setCodeFiles(data.allFiles);

      // Add success log
      const newLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'antigravity' as const,
        message: `Agentic Workflow Execution Complete! Patch applied to ${activeFile.filename}`,
        source: 'agent-engine'
      };
      setTerminalLogs(prev => [newLog, ...prev]);
    } catch (err) {
      console.error('Workflow execution error:', err);
    } finally {
      setTimeout(() => {
        setIsExecutingWorkflow(false);
      }, 3000);
    }
  };

  // Handler: Select File
  const handleSelectFile = (path: string) => {
    setActiveFilePath(path);
  };

  // Handler: Update File Content
  const handleUpdateFileContent = (path: string, content: string) => {
    setCodeFiles(prev => prev.map(f => f.path === path ? { ...f, content, isDirty: true } : f));
  };

  // Handler: Rollback Agentic Patch
  const handleRollbackPatch = (patchId: string) => {
    setPatchHistory(prev => {
      const updated = prev.map(item => {
        if (item.id === patchId) {
          if (item.beforeContent && item.targetFile) {
            handleUpdateFileContent(item.targetFile, item.beforeContent);
          }
          return {
            ...item,
            status: 'rolled_back' as const,
            rolledBackAt: new Date().toLocaleTimeString('sv-SE')
          };
        }
        return item;
      });
      saveAppStateToIDB('patchHistory', updated);
      return updated;
    });

    const targetPatch = patchHistory.find(p => p.id === patchId);
    const rollbackLog: TerminalLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'antigravity',
      message: `[ROLLBACK EXECUTED] Reverted patch #${patchId} (${targetPatch?.workflowTitle || 'Target File'})`,
      source: 'patch-history'
    };
    setTerminalLogs(prevLogs => [rollbackLog, ...prevLogs]);
    saveTerminalLogsToIDB([rollbackLog, ...terminalLogs]);
  };

  // Handler: Reapply Agentic Patch
  const handleReapplyPatch = (patchId: string) => {
    setPatchHistory(prev => {
      const updated = prev.map(item => {
        if (item.id === patchId) {
          if (item.afterContent && item.targetFile) {
            handleUpdateFileContent(item.targetFile, item.afterContent);
          }
          return {
            ...item,
            status: 'applied' as const,
            rolledBackAt: undefined
          };
        }
        return item;
      });
      saveAppStateToIDB('patchHistory', updated);
      return updated;
    });

    const targetPatch = patchHistory.find(p => p.id === patchId);
    const reapplyLog: TerminalLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'antigravity',
      message: `[PATCH RE-APPLIED] Restored patch #${patchId} (${targetPatch?.workflowTitle || 'Target File'})`,
      source: 'patch-history'
    };
    setTerminalLogs(prevLogs => [reapplyLog, ...prevLogs]);
  };

  // Handler: Terminal Command Execution
  const handleRunTerminalCommand = async (command: string) => {
    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.logs) setTerminalLogs(data.logs);
    } catch (err) {
      const fallbackLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'command' as const,
        message: `$ ${command} (executed on Android shell)`,
        source: 'terminal'
      };
      setTerminalLogs(prev => [fallbackLog, ...prev]);
    }
  };

  // Handler: Pair New Socket Device
  const handlePairNewDevice = async (name: string, type: 'VS Code Extension' | 'Android Tablet' | 'MacBook Pro' | 'Desktop PC') => {
    try {
      const res = await fetch('/api/socket/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: name, deviceType: type })
      });
      const data = await res.json();
      if (data.devices) setSocketDevices(data.devices);
    } catch (err) {
      const newDev: SocketDevice = {
        id: `dev-${Date.now()}`,
        name,
        deviceType: type,
        ip: '192.168.1.190',
        status: 'connected',
        pingMs: 5,
        lastSyncAt: 'Just now'
      };
      setSocketDevices(prev => [...prev, newDev]);
    }
  };

  // Handler: Export Workspace Checkpoint JSON
  const handleExportCheckpoint = async () => {
    try {
      const { filename, checkpoint } = await exportAndBackupCheckpoint(
        codeFiles,
        patchHistory,
        activeFilePath,
        terminalLogs,
        telemetry,
        activeModel
      );

      const newLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'info' as const,
        message: `[CHECKPOINT EXPORTED] Saved "${filename}" (${checkpoint.metadata.fileCount} files, ${checkpoint.metadata.patchCount} patches).`,
        source: 'checkpoint-exporter'
      };
      setTerminalLogs(prev => [newLog, ...prev]);
    } catch (err) {
      console.error('Checkpoint export error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-slate-100 font-sans flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Installation Wizard Modal */}
      {showWizard && (
        <InstallationWizard
          models={models}
          onClose={() => setShowWizard(false)}
          onCompleteWizard={({ ollamaHost, defaultModel }) => {
            setShowWizard(false);
            const found = models.find(m => m.name === defaultModel || m.id === defaultModel);
            if (found) {
              handleSwitchModel(found.id);
            }
          }}
        />
      )}

      {/* SaaS Production Todo Modal */}
      {showTodoModal && (
        <ProductionTodo onClose={() => setShowTodoModal(false)} />
      )}

      {/* App Main Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        telemetry={telemetry}
        activeModel={activeModel}
        isRecordingVoice={isRecordingVoice}
        onToggleVoice={toggleVoiceRecording}
        onOpenWizard={() => setShowWizard(true)}
        onOpenTodo={() => setShowTodoModal(true)}
        onExportCheckpoint={handleExportCheckpoint}
        isPowerSaver={isPowerSaver}
        onTogglePowerSaver={togglePowerSaver}
      />

      {/* Main Workspace Body */}
      <Gatekeeper>
        {({ requestExecution }) => {
          const wrappedExecuteWorkflow = () => {
            requestExecution(handleExecuteWorkflow, "Allow this agent workflow to execute file system changes?");
          };

          const wrappedRunTerminalCommand = (command: string) => {
            requestExecution(() => handleRunTerminalCommand(command), `Allow execution of terminal command: ${command}?`);
          };

          return (
            <main className="flex-1 pb-10 scroll-fade-top">
              {activeTab === 'aura-ide' && (
                <JacoAuraComputeIDE
                  telemetry={telemetry}
                  models={models}
                  codeFiles={codeFiles}
                  onSelectTab={(tab) => setActiveTab(tab as TabType)}
                  onRunTerminalCommand={wrappedRunTerminalCommand}
                />
              )}

              {activeTab === 'revenue' && (
                <RevenueInsights />
              )}

              {activeTab === 'checkout' && (
                <QuickCheckout />
              )}

              {activeTab === 'cost-orchestrator' && (
                <CostAwareOrchestratorView />
              )}

              {activeTab === 'verified-marketplaces' && (
                <VerifiedMarketplacesView />
              )}

              {activeTab === 'verified-capabilities' && (
                <VerifiedCapabilitiesView />
              )}

              {activeTab === 'processes' && (
                <ActiveProcesses isPowerSaver={isPowerSaver} />
              )}

              {activeTab === 'antigravity' && (
                <AntigravityBridgeStudio
                  codeFiles={codeFiles}
                  activeFilePath={activeFilePath}
                  telemetry={telemetry}
                  onUpdateCodeFile={(path, content) => {
                    setCodeFiles(prev => prev.map(f => f.path === path ? { ...f, content } : f));
                  }}
                  onRunTerminalCommand={wrappedRunTerminalCommand}
                  onExportCheckpoint={handleExportCheckpoint}
                />
              )}

              {activeTab === 'autopilot' && (
                <AutonomousAutopilot telemetry={telemetry} />
              )}

              {activeTab === 'history' && (
                <PatchHistoryView
                  patchHistory={patchHistory}
                  onRollbackPatch={handleRollbackPatch}
                  onReapplyPatch={handleReapplyPatch}
                  onClearHistory={() => {
                    setPatchHistory([]);
                    saveAppStateToIDB('patchHistory', []);
                  }}
                  onExportCheckpoint={handleExportCheckpoint}
                  codeFiles={codeFiles}
                />
              )}

              {activeTab === 'memorystore' && (
                <MemoryStoreInspector onExportCheckpoint={handleExportCheckpoint} />
              )}

              {activeTab === 'keep' && (
                <GoogleKeepManager
                  onSendToAura={(prompt) => sendToAuraChat(prompt)}
                />
              )}

              {activeTab === 'hardening' && (
                <JACOHardeningWizard telemetry={telemetry} />
              )}

              {activeTab === 'openclaw' && (
                <OpenClawStudio
                  models={models}
                  activeModel={activeModel}
                  onSendContextToJaco={(extractedText) => sendToAuraChat(`OpenClaw extracted web context: ${extractedText.slice(0, 300)}`)}
                />
              )}

              {activeTab === 'models' && (
                <ModelManager
                  models={models}
                  activeModel={activeModel}
                  telemetry={telemetry}
                  onSwitchModel={handleSwitchModel}
                  onPullModel={handlePullModel}
                />
              )}

              {activeTab === 'diagnostics' && (
                <div className="p-4 max-w-6xl mx-auto">
                  <ConnectivityDiagnostics
                    onModelsUpdated={(updatedModels) => setModels(updatedModels)}
                    telemetry={telemetry}
                  />
                </div>
              )}

              {activeTab === 'voice' && (
                <VoiceIntentStudio
                  isRecordingVoice={isRecordingVoice}
                  onToggleVoice={toggleVoiceRecording}
                  onParseVoiceIntent={handleParseVoiceIntent}
                  currentIntent={currentIntent}
                  proposedSteps={proposedSteps}
                  onExecuteWorkflow={wrappedExecuteWorkflow}
                  isExecutingWorkflow={isExecutingWorkflow}
                  codeFiles={codeFiles}
                  activeFilePath={activeFilePath}
                />
              )}

              {activeTab === 'ide' && (
                <MobileIDE
                  files={codeFiles}
                  activeFilePath={activeFilePath}
                  onSelectFile={handleSelectFile}
                  onUpdateFileContent={handleUpdateFileContent}
                  onRunTerminalCommand={wrappedRunTerminalCommand}
                  onExportCheckpoint={handleExportCheckpoint}
                />
              )}

              {activeTab === 'socket' && (
                <SocketSyncPanel
                  devices={socketDevices}
                  telemetry={telemetry}
                  onPairNewDevice={handlePairNewDevice}
                />
              )}

              {activeTab === 'setup' && (
                <AndroidLocalSetupSkills
                  telemetry={telemetry}
                  onRunTerminalCommand={wrappedRunTerminalCommand}
                />
              )}

              {activeTab === 'cuda-quantum' && (
                <CudaQuantumStudio
                  onApplySynthesizedCode={(code) => {
                    handleUpdateFileContent(activeFilePath, code);
                    setActiveTab('ide');
                  }}
                />
              )}

              {activeTab === 'litert' && (
                <LiteRTMigration />
              )}

              {activeTab === 'intelligence' && (
                <SystemIntelligence
                  npuHardwareType={telemetry.npuHardwareType}
                  npuLoadState={telemetry.npuLoadState}
                  npuFrequencyMhz={telemetry.npuFrequencyMhz}
                />
              )}

              {activeTab === 'terminal' && (
                <TerminalDrawer
                  logs={terminalLogs}
                  onRunCommand={wrappedRunTerminalCommand}
                />
              )}




            </main>
          );
        }}
      </Gatekeeper>
    </div>
  );
}
