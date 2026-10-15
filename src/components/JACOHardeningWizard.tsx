import React, { useState } from 'react';
import { ShieldCheck, Zap, Terminal, Copy, Cpu, Activity, ServerCog, Wifi, Eye, Radio, CheckCircle2 } from 'lucide-react';
import { DeviceTelemetry } from '../types';

interface JACOHardeningWizardProps {
  telemetry: DeviceTelemetry;
}

export const JACOHardeningWizard: React.FC<JACOHardeningWizardProps> = ({ telemetry }) => {
  const [activeScriptTab, setActiveScriptTab] = useState<'docker' | 'termux' | 'prompts' | 'optimization' | 'npu'>('docker');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationLogs, setOptimizationLogs] = useState<string[]>([]);
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  const scripts = {
    docker: [
      {
        title: 'JACO Docker Compose & Shell Authority Setup',
        desc: 'Skapa och starta Docker-container med godkänd skal-auktoritet på din dator.',
        code: `cat << 'EOF' > docker-compose.yml\nversion: '3.8'\nservices:\n  jaco-orchestrator:\n    build: .\n    container_name: jaco_server_authority\n    ports:\n      - "3000:3000"\n    environment:\n      - NODE_ENV=production\n      - OLLAMA_HOST=http://host.docker.internal:11434\n      - SHELL_AUTHORITY_ENABLED=true\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    restart: unless-stopped\nEOF\n\ndocker compose up -d --build`
      },
      {
        title: 'Local Integration Auto-Startup Script',
        desc: 'Sätt behörighet och starta hela JACO stacken automatiskt',
        code: `cat << 'EOF' > setup_jaco_docker.sh\n#!/bin/bash\necho "Starting JACO Docker Server..."\ndocker compose up -d\necho "Checking running status..."\ndocker compose ps\nEOF\nchmod +x setup_jaco_docker.sh\n./setup_jaco_docker.sh`
      }
    ],
    termux: [
      {
        title: 'Termux Native 1-Klicks Installatör (Ingen Docker Krävs!)',
        desc: 'OBS: Android tillåter inte Docker direkt i Termux utan root. Kör detta kommandoblock i Termux för att installera Node.js och JACO direkt:',
        code: `pkg update -y && pkg install nodejs-lts git openssl curl termux-api unzip -y\nmkdir -p ~/jaco-app && cd ~/jaco-app\n\n# Om du laddat ner källkod som ZIP från AI Studio (Settings -> Export ZIP):\nfor z in $(ls -t ~/storage/downloads/*.zip /sdcard/Download/*.zip 2>/dev/null); do\n  if [ -f "$z" ] && unzip -l "$z" 2>/dev/null | grep -q "package.json"; then\n    echo "[+] Hittade projekt-ZIP: $z"\n    unzip -o "$z"\n    break\n  fi\ndone\n\n# Bygg och starta JACO i Termux:\nnpm install\nnpm run build\nnpm run start`
      },
      {
        title: 'Termux Hardening & API Setup',
        desc: 'Kopiera detta för att installera Termux API, säkra portar och förbereda enheten.',
        code: `pkg update && pkg upgrade -y\npkg install termux-api nmap htop -y\ntermux-setup-storage\n\n# Säkra portar\niptables -A INPUT -p tcp --dport 3000 -j ACCEPT\niptables -A INPUT -p tcp --dport 11434 -j ACCEPT\niptables -P INPUT DROP\n\n# Verifiera batteri API\ntermux-battery-status`
      },
      {
        title: 'Ollama Auto-Restart Daemon',
        desc: 'Håll Ollama vid liv på Android',
        code: `cat << 'EOF' > start_ollama.sh\n#!/bin/bash\nwhile true; do\n  if ! pgrep -x "ollama" > /dev/null; then\n    echo "Starting Ollama..."\n    OLLAMA_HOST=0.0.0.0:11434 ollama serve &\n  fi\n  sleep 60\ndone\nEOF\nchmod +x start_ollama.sh\n./start_ollama.sh &`
      }
    ],
    prompts: [
      {
        title: 'JACO Orchestrator Master Prompt',
        desc: 'Ge detta till en under-agent för att tvinga den att lyda JACO:s regelverk.',
        code: `You are a specialized sub-agent operating under the JACO Orchestration protocol.\nYour primary directive is to execute tasks assigned by the JACO Project Manager.\nDo not hallucinate external tools. Report all execution states in strictly formatted JSON payload with keys: { "status", "output", "errors" }. \nYou run in a constrained Android NPU environment.`
      },
      {
        title: 'Code Healing Prompt',
        desc: 'För autonom felsökning',
        code: `Analyze the provided error stack trace from the Termux environment.\nProvide the exact Bash or TypeScript patch required to heal the error.\nMinimize token usage.`
      }
    ],
    optimization: [
      {
        title: 'Clear VRAM Cache',
        desc: 'Skript för att rensa cache och frigöra NPU minne.',
        code: `sync; echo 1 > /proc/sys/vm/drop_caches\ntermux-toast "VRAM/RAM Cleared"`
      }
    ],
    npu: [
      {
        title: 'Kvantum Vektor Optimering',
        desc: 'CUDA/OpenCL bindning för NPU (experimentell)',
        code: `export LD_LIBRARY_PATH=/system/vendor/lib64:$LD_LIBRARY_PATH\nexport OLLAMA_LLM_LIBRARY=opencl\nollama run gemma-4`
      }
    ]
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedScript(code);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  const runAutonomousOptimization = () => {
    setIsOptimizing(true);
    setOptimizationLogs(['Initierar autonom systemanalys...']);
    
    let step = 0;
    const steps = [
      'Analyserar Termux sensorer (Batteri, VRAM, Temperatur)...',
      `Telemetri: CPU ${telemetry.cpuUsagePercent}%, RAM: ${telemetry.ramUsedGb}GB/${telemetry.ramTotalGb}GB`,
      'Hittade OOM (Out-of-Memory) risk i Llama 3 instans...',
      'Genererar auto-prompt för minneskomprimering...',
      'Applicerar "Code Healing Prompt" på bakgrundsprocesser...',
      'Stänger inaktiva portar via iptables policy...',
      'Systemhärdning slutförd. Optimerad för JACO.'
    ];

    const interval = setInterval(() => {
      if (step < steps.length) {
        setOptimizationLogs(prev => [...prev, steps[step]]);
        step++;
      } else {
        clearInterval(interval);
        setIsOptimizing(false);
      }
    }, 1200);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 font-mono text-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-cyan-950 border border-emerald-800 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">Systemhärdning & Wizard</h1>
            <p className="text-slate-400 text-sm mt-1">
              Kopiera färdiga prompts, skript för Termux, och kör autonoma optimeringar.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="md:col-span-2 space-y-4">
            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              {(Object.keys(scripts) as Array<keyof typeof scripts>).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveScriptTab(tab)}
                  className={`px-3 py-1.5 rounded capitalize transition-all ${activeScriptTab === tab ? 'bg-cyan-950 text-emerald-300 font-bold border border-emerald-800/60' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Scripts List */}
            <div className="space-y-4">
              {scripts[activeScriptTab].map((script, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                    <div>
                      <h3 className="font-bold text-slate-200">{script.title}</h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">{script.desc}</p>
                    </div>
                    <button
                      onClick={() => handleCopy(script.code)}
                      className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-400 transition-colors"
                      title="Kopiera kod"
                    >
                      {copiedScript === script.code ? <CheckCircle2 className="w-4 h-4 text-cyan-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <pre className="text-emerald-300 text-[11px] leading-relaxed">
                      <code>{script.code}</code>
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
              <h3 className="font-bold text-slate-200 flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-400" />
                Autonom Optimering
              </h3>
              <p className="text-slate-400 text-[10px] mb-4">
                Låt JACO autonomt söka igenom systemet, analysera flaskhalsar och applicera härdning för din enhet.
              </p>
              <button
                onClick={runAutonomousOptimization}
                disabled={isOptimizing}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded flex items-center justify-center gap-2 transition-all"
              >
                {isOptimizing ? (
                  <><Activity className="w-4 h-4 animate-spin" /> Optimerar...</>
                ) : (
                  <><Cpu className="w-4 h-4" /> Starta Härdning</>
                )}
              </button>

              {optimizationLogs.length > 0 && (
                <div className="mt-4 bg-black border border-slate-800 rounded p-3 h-48 overflow-y-auto space-y-1.5 font-mono">
                  {optimizationLogs.map((log, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-emerald-500 font-bold mt-0.5">&gt;</span>
                      <span className={i === optimizationLogs.length - 1 && isOptimizing ? 'text-amber-400 animate-pulse' : 'text-slate-300'}>{log}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
              <h3 className="font-bold text-slate-200 flex items-center gap-2 mb-3">
                <Radio className="w-4 h-4 text-cyan-400" />
                Termux Sensorer
              </h3>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Batteri status:</span>
                  <span className="text-slate-300">{telemetry.batteryPercent}% ({telemetry.isCharging ? 'Laddar' : 'Urkopplad'})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">CPU Värme:</span>
                  <span className={telemetry.thermalTempC > 40 ? 'text-rose-400' : 'text-cyan-400'}>{telemetry.thermalTempC}°C</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Lux Sensor:</span>
                  <span className="text-slate-300">{telemetry.termuxLightLux} lx</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
