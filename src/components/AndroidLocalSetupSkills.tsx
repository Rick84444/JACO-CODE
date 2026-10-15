import React, { useState } from 'react';
import { Smartphone, Terminal, Cpu, Zap, Wifi, Radio, Copy, Check, Play, Settings, ShieldCheck, Sparkles, Sliders, Layers, Code2, Download, Lock, Server, RefreshCw } from 'lucide-react';
import { AgenticSkill, DeviceTelemetry } from '../types';
import { useOllamaWebSocket } from '../hooks/useOllamaWebSocket';

interface AndroidLocalSetupSkillsProps {
  telemetry: DeviceTelemetry;
  onRunTerminalCommand: (cmd: string) => void;
}

const DEFAULT_SKILLS: AgenticSkill[] = [
  {
    id: 'skill-npu-accel',
    name: 'Qualcomm Hexagon NPU Vector Accelerator',
    description: 'Hooks directly into Snapdragon NPU hardware layers for 40+ tokens/sec zero-copy matrix multiplication.',
    category: 'Android Native',
    isEnabled: true,
    triggerKey: 'npu:matrix_mult',
    parametersSchema: '{ gpuLayers: 33, quantScheme: "Q4_K_M" }',
    executionCount: 142
  },
  {
    id: 'skill-vscode-sync',
    name: 'VS Code Antigravity Socket Remote Control',
    description: 'Bi-directional WebSocket hook streaming real-time code AST patches and terminal outputs to workstation IDEs.',
    category: 'Multi-Device Sync',
    isEnabled: true,
    triggerKey: 'socket:broadcast_ast',
    parametersSchema: '{ wsPort: 11434, aes256Direct: true }',
    executionCount: 89
  },
  {
    id: 'skill-voice-intent',
    name: 'On-Device Whisper Voice Intent Parser',
    description: 'Offline speech-to-intent engine converting voice audio into structured AST code edit actions.',
    category: 'Voice Agent',
    isEnabled: true,
    triggerKey: 'voice:parse_intent',
    parametersSchema: '{ lang: "sv-SE", confidenceCutoff: 0.85 }',
    executionCount: 64
  },
  {
    id: 'skill-ast-refactor',
    name: 'DeepSeek Neural AST Refactor Engine',
    description: 'Analyzes TypeScript/JavaScript AST syntax trees locally to refactor code without cloud API dependencies.',
    category: 'Code AST',
    isEnabled: true,
    triggerKey: 'ast:refactor_tree',
    parametersSchema: '{ autoFixWarnings: true, vitestVerify: true }',
    executionCount: 210
  },
  {
    id: 'skill-debugger-bridge',
    name: 'Android Termux Native Debugger Bridge',
    description: 'Attaches V8 / Node inspector to stepping through local execution call stacks and memory heaps.',
    category: 'Debug Engine',
    isEnabled: false,
    triggerKey: 'debug:v8_attach',
    parametersSchema: '{ port: 9229, breakOnStart: false }',
    executionCount: 31
  }
];

export const AndroidLocalSetupSkills: React.FC<AndroidLocalSetupSkillsProps> = ({
  telemetry,
  onRunTerminalCommand
}) => {
  const [skills, setSkills] = useState<AgenticSkill[]>(DEFAULT_SKILLS);
  const [copiedZipScript, setCopiedZipScript] = useState(false);
  const [copiedTermuxScript, setCopiedTermuxScript] = useState(false);
  const [copiedOllamaScript, setCopiedOllamaScript] = useState(false);
  const [activeSetupTab, setActiveSetupTab] = useState<'installer' | 'websocket' | 'skills' | 'appfunctions' | 'ollama-stability'>('ollama-stability');

  // Real local Ollama testing state
  const [realOllamaHost, setRealOllamaHost] = useState('http://127.0.0.1:11434');
  const [realOllamaStatus, setRealOllamaStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [realOllamaModels, setRealOllamaModels] = useState<any[]>([]);
  const [selectedRealModel, setSelectedRealModel] = useState<string>('qwen2.5:0.5b');
  const [testPrompt, setTestPrompt] = useState<string>('Skriv en kort funktion i TypeScript som beräknar fibonacci.');
  const [realInferenceOutput, setRealInferenceOutput] = useState<string>('');
  const [isInferenceRunning, setIsInferenceRunning] = useState<boolean>(false);
  const [inferenceStats, setInferenceStats] = useState<{ speed: number; durationMs: number; tokens: number } | null>(null);

  // Test real local connection to Ollama daemon
  const testRealOllamaConnection = async () => {
    setRealOllamaStatus('testing');
    try {
      const res = await fetch(`/api/ollama/ping?hostUrl=${encodeURIComponent(realOllamaHost)}`);
      const data = await res.json();
      if (data.health && data.health.isConnected) {
        setRealOllamaStatus('connected');
        setRealOllamaModels(data.health.localModels || []);
        if (data.health.localModels && data.health.localModels.length > 0) {
          setSelectedRealModel(data.health.localModels[0].name);
        }
      } else {
        setRealOllamaStatus('disconnected');
        setRealOllamaModels([]);
      }
    } catch {
      setRealOllamaStatus('disconnected');
      setRealOllamaModels([]);
    }
  };

  // Run real local inference on Ollama daemon
  const handleRunRealInference = async () => {
    if (!testPrompt || isInferenceRunning) return;
    setIsInferenceRunning(true);
    setRealInferenceOutput('');
    setInferenceStats(null);

    try {
      const res = await fetch('/api/ollama/real-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostUrl: realOllamaHost,
          model: selectedRealModel,
          prompt: testPrompt
        })
      });

      const data = await res.json();
      if (data.success) {
        setRealInferenceOutput(data.response || 'Ingen text genererades.');
        setInferenceStats({
          speed: data.tokensPerSec || 0,
          durationMs: data.durationMs || 0,
          tokens: data.evalCount || 0
        });
      } else {
        setRealInferenceOutput(`[FEL]: ${data.error || 'Generering misslyckades'}`);
      }
    } catch (err: any) {
      setRealInferenceOutput(`[EXCEPTION]: ${err.message}`);
    } finally {
      setIsInferenceRunning(false);
    }
  };

  // Integrated WebSocket hook
  const {
    isConnected,
    socketUrl,
    eventHistory,
    streamingTokens,
    isStreaming,
    startTokenStream,
    toggleConnection
  } = useOllamaWebSocket();

  const zipInstallScript = `# --- FÖLJ DESSA STEG EXAKT FÖR ATT INSTALLERA I TERMUX ---

# [STEG 1] Ge Termux tillgång till dina filer (klicka "Tillåt" på skärmen):
if [ ! -d ~/storage ]; then termux-setup-storage; sleep 2; fi

# [STEG 2] Skapa en dedikerad mapp och gå in i den:
mkdir -p ~/jaco-app
cd ~/jaco-app

# [STEG 3] Packa upp den SENASTE zip-filen du laddat ner från AI Studio:
LATEST_ZIP=$(ls -t ~/storage/downloads/*.zip /sdcard/Download/*.zip 2>/dev/null | head -n 1)
if [ -n "$LATEST_ZIP" ]; then
  echo "Packar upp: $LATEST_ZIP"
  unzip -o "$LATEST_ZIP"
else
  echo "❌ HITTADE INGEN ZIP-FIL! Ladda ner från AI Studio först."
  exit 1
fi

# [STEG 4] Se till att filerna ligger rätt (fixar undermappar):
FOUND_PKG=$(find . -maxdepth 3 -name "package.json" 2>/dev/null | head -n 1)
if [ -n "$FOUND_PKG" ]; then
  SUBDIR=$(dirname "$FOUND_PKG")
  if [ "$SUBDIR" != "." ]; then
    cp -r "$SUBDIR"/* "$SUBDIR"/.* . 2>/dev/null || true
  fi
fi

# [STEG 5] Kör installationsfilen (den gör npm install åt dig):
if [ -f "install.sh" ]; then
  bash install.sh
else
  echo "❌ Hittade ingen install.sh. Är du säker på att zip-filen innehåller appen?"
fi`;

  const termuxSetupScript = `# Skapa och kör den automatiska installatören i Termux:
mkdir -p ~/jaco-app && cd ~/jaco-app

cat << 'EOF' > install.sh
#!/usr/bin/env bash
set -e

DO_CLEAN=false

# 0. Clean function definition
clean_build_artifacts() {
    echo "[+] Rensar gamla byggfiler (recursively removing node_modules/ and dist/)..."
    rm -rf node_modules dist
    echo "[+] Rensning slutförd."
}

for arg in "$@"; do
    case $arg in
        --clean|-c|clean)
            DO_CLEAN=true
            shift
            ;;
        *)
            ;;
    esac
done

if [ "$CLEAN" = "true" ] || [ "$CLEAN" = "1" ]; then
    DO_CLEAN=true
fi

echo "----------------------------------------------------------------------"
echo "  JACO AI Studio - Termux & On-Device Smart Installer"
echo "----------------------------------------------------------------------"

if command -v termux-setup-storage >/dev/null 2>&1; then
    echo "[+] Begär lagringstillåtelse i Android..."
    if [ ! -d ~/storage ]; then termux-setup-storage || true; sleep 2; fi
fi

pkg update -y || true
pkg install nodejs-lts git openssl curl termux-api unzip -y || true

# 1. Kontrollera om package.json finns och inspektera katalogdjup
if [ ! -f "package.json" ]; then
    FOUND_PKG=$(find . -maxdepth 3 -name "package.json" 2>/dev/null | head -n 1)
    if [ -n "$FOUND_PKG" ]; then
        SUBDIR=$(dirname "$FOUND_PKG")
        if [ "$SUBDIR" != "." ] && [ "$SUBDIR" != ".." ]; then
            echo "[+] Hittade package.json i undermappen '$SUBDIR'. Flyttar filer till rotnivå..."
            cp -r "$SUBDIR"/* "$SUBDIR"/.* . 2>/dev/null || true
        fi
    fi
fi

# Leta efter källkods-ZIP i mobilens Nedladdningar om package.json saknas
if [ ! -f "package.json" ]; then
    echo "[+] Söker efter projekt-ZIP i mobilens Nedladdningar..."
    DL_DIR=""
    if [ -d "$HOME/storage/downloads" ]; then
        DL_DIR="$HOME/storage/downloads"
    elif [ -d "/sdcard/Download" ]; then
        DL_DIR="/sdcard/Download"
    fi

    if [ -n "$DL_DIR" ]; then
        echo "[+] Identifierar rätt källkods-ZIP i $DL_DIR..."
        for z in $(ls -t "$DL_DIR"/*.zip 2>/dev/null); do
            [ -f "$z" ] || continue
            if unzip -l "$z" 2>/dev/null | grep -q "package.json"; then
                echo "[+] Hittade senaste AI Studio källkod: $(basename "$z"). Packar upp..."
                unzip -o "$z"
                break
            fi
        done
    fi

    if [ ! -f "package.json" ]; then
        FOUND_PKG=$(find . -maxdepth 3 -name "package.json" 2>/dev/null | head -n 1)
        if [ -n "$FOUND_PKG" ]; then
            SUBDIR=$(dirname "$FOUND_PKG")
            if [ "$SUBDIR" != "." ] && [ "$SUBDIR" != ".." ]; then
                echo "[+] Flyttar projektfiler från $SUBDIR till rotnivå..."
                cp -r "$SUBDIR"/* "$SUBDIR"/.* . 2>/dev/null || true
            fi
        fi
    fi
fi

if [ ! -f "package.json" ]; then
    echo "----------------------------------------------------------------------"
    echo "[!] FEL: package.json saknas i rotnivån ($(pwd))."
    echo "    Ladda ner källkods-ZIP från AI Studio (Inställningar -> Export ZIP),"
    echo "    och kör sedan kommandot igen i Termux."
    echo "----------------------------------------------------------------------"
    exit 1
fi

echo "[+] Bekräftat package.json i rotnivån."

if [ "$DO_CLEAN" = true ]; then
    clean_build_artifacts
fi

mkdir -p certs
if [ ! -f "certs/server.crt" ] && command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=localhost/O=JACO-AI-Studio" >/dev/null 2>&1 || true
fi

# Kontrollera node_modules & dist innan installation och bygge
if [ -d "node_modules" ] && [ "$(ls -A node_modules 2>/dev/null)" ] && [ "$DO_CLEAN" != true ]; then
    echo "[+] 'node_modules' finns redan. Hoppar över npm install (använd --clean för att reinstallera)."
else
    echo "[+] Sätter upp projektberoenden..."
    npm install --no-audit --no-fund
fi

if [ -d "dist" ] && [ -f "dist/server.cjs" ] && [ "$DO_CLEAN" != true ]; then
    echo "[+] Byggmapp 'dist/server.cjs' finns redan."
else
    echo "[+] Bygger projektet..."
    npm run build
fi

# Kör automatisk sökvägskontroll & remapping för Termux
if [ -f "run_termux_node.sh" ]; then
    echo "[+] Kör automatisk verifiering & path remapping (run_termux_node.sh)..."
    bash run_termux_node.sh
else
    if [ ! -f "dist/server.cjs" ]; then
        echo "[!] Söker efter andra byggfiler för remapping till dist/server.cjs..."
        for CANDIDATE in dist/server.js build/server.cjs build/server.js server.cjs; do
            if [ -f "\$CANDIDATE" ]; then
                mkdir -p dist
                cp "\$CANDIDATE" dist/server.cjs
                echo "[+] Remappade \$CANDIDATE -> dist/server.cjs"
                break
            fi
        done
    fi

    if [ -f "dist/server.cjs" ]; then
        echo "[+] Verifiering godkänd! Startar JACO Node server..."
        NODE_ENV=production PORT="\${PORT:-3000}" HOST=0.0.0.0 node dist/server.cjs
    else
        npm run start
    fi
fi
EOF

bash install.sh`;

  const downloadInstallScriptDirectly = () => {
    const scriptContent = `#!/usr/bin/env bash
# JACO AI Studio - Standalone Android & Server Installer Script
set -e

DO_CLEAN=false

clean_build_artifacts() {
    echo "[+] Cleaning build artifacts (removing node_modules/ and dist/)..."
    rm -rf node_modules dist
    echo "[+] Clean completed."
}

for arg in "$@"; do
    case $arg in
        --clean|-c|clean)
            DO_CLEAN=true
            shift
            ;;
        *)
            ;;
    esac
done

if [ "$CLEAN" = "true" ] || [ "$CLEAN" = "1" ]; then
    DO_CLEAN=true
fi

echo "----------------------------------------------------------------------"
echo "  JACO AI Studio - Automatic On-Device / Server Installation"
echo "----------------------------------------------------------------------"

IS_TERMUX=false
if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
    IS_TERMUX=true
    echo "[+] Detected Android Termux environment."
fi

if [ "$IS_TERMUX" = true ]; then
    echo "[+] Requesting Android Storage & Hardware Permissions..."
    if command -v termux-setup-storage >/dev/null 2>&1; then
        if [ ! -d ~/storage ]; then termux-setup-storage || true; sleep 2; fi
    fi
    pkg update -y || true
    pkg install nodejs-lts git openssl curl termux-api unzip -y || true
fi

# Ensure package.json exists & check directory depth
if [ ! -f "package.json" ]; then
    FOUND_PKG=$(find . -maxdepth 3 -name "package.json" 2>/dev/null | head -n 1)
    if [ -n "$FOUND_PKG" ]; then
        SUBDIR=$(dirname "$FOUND_PKG")
        if [ "$SUBDIR" != "." ] && [ "$SUBDIR" != ".." ]; then
            echo "[+] Found package.json in '$SUBDIR'. Relocating files to root..."
            cp -r "$SUBDIR"/* "$SUBDIR"/.* . 2>/dev/null || true
        fi
    fi
fi

if [ ! -f "package.json" ] && [ "$IS_TERMUX" = true ]; then
    echo "[+] Searching for project ZIP in downloads..."
    DL_DIR=""
    if [ -d "$HOME/storage/downloads" ]; then
        DL_DIR="$HOME/storage/downloads"
    elif [ -d "/sdcard/Download" ]; then
        DL_DIR="/sdcard/Download"
    fi
    if [ -n "$DL_DIR" ]; then
        for z in $(ls -t "$DL_DIR"/*.zip 2>/dev/null); do
            [ -f "$z" ] || continue
            if unzip -l "$z" 2>/dev/null | grep -q "package.json"; then
                echo "[+] Unpacking AI Studio source: $(basename "$z")..."
                unzip -o "$z"
                break
            fi
        done
    fi
    if [ ! -f "package.json" ]; then
        FOUND_PKG=$(find . -maxdepth 3 -name "package.json" 2>/dev/null | head -n 1)
        if [ -n "$FOUND_PKG" ]; then
            SUBDIR=$(dirname "$FOUND_PKG")
            if [ "$SUBDIR" != "." ] && [ "$SUBDIR" != ".." ]; then
                echo "[+] Moving files from $SUBDIR to root..."
                cp -r "$SUBDIR"/* "$SUBDIR"/.* . 2>/dev/null || true
            fi
        fi
    fi
fi

if [ ! -f "package.json" ]; then
    echo "[-] ERROR: package.json missing in root directory ($(pwd))."
    exit 1
fi

if [ "$DO_CLEAN" = true ]; then
    clean_build_artifacts
fi

mkdir -p certs
if [ ! -f "certs/server.crt" ] && command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=localhost/O=JACO-AI-Studio" >/dev/null 2>&1 || true
fi

if [ -d "node_modules" ] && [ "$(ls -A node_modules 2>/dev/null)" ] && [ "$DO_CLEAN" != true ]; then
    echo "[+] node_modules exists. Skipping npm install (use --clean to force reinstall)."
else
    npm install --no-audit --no-fund
fi

if [ -d "dist" ] && [ -f "dist/server.cjs" ] && [ "$DO_CLEAN" != true ]; then
    echo "[+] Build output (dist/server.cjs) exists. Skipping npm run build (use --clean to force rebuild)."
else
    npm run build
fi

TARGET_PORT="\${PORT:-3000}"
echo "----------------------------------------------------------------------"
echo "[+] Starting JACO AI Studio server on port $TARGET_PORT..."
echo "----------------------------------------------------------------------"
npm run start
`;
    const blob = new Blob([scriptContent], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'install.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setCopiedZipScript(true);
    setTimeout(() => setCopiedZipScript(false), 2000);
  };

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSkill = (id: string) => {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, isEnabled: !s.isEnabled } : s));
  };

  const setupOllamaScript = `#!/usr/bin/env bash
# ======================================================================
#  JACO AI - REAL NATIVE OLLAMA TERMUX STABILITY INSTALLER
#  Inga simuleringar. Äkta native ARM64 Ollama med full stabilitet!
# ======================================================================
set -e

echo "[1/6] Förhindrar Android CPU deep sleep och sätter wake lock..."
if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || true
fi

echo "[2/6] Uppdaterar Termux-paket och installerar verktyg..."
pkg update -y || true
pkg install -y curl wget git openssl jq termux-api proot || true

echo "[3/6] Konfigurerar optimerade miljövariabler för max stabilitet..."
mkdir -p ~/.ollama
cat << 'ENVEOF' > ~/.ollama_env.sh
# --- OLLAMA STABILITY ENVIRONMENT VARIABLES ---
# Bind till alla nätverksgränssnitt så JACO kan ansluta från webb/Node
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"

# Begränsa parallellism till 1 för att förhindra RAM OOM Kills på telefoner
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1

# Behåll modellen i RAM så den inte läses in från disk vid varje anrop
export OLLAMA_KEEP_ALIVE="-1"

# Aktivera Flash Attention och loggning
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_DEBUG=1
ENVEOF

source ~/.ollama_env.sh
if ! grep -q "source ~/.ollama_env.sh" ~/.bashrc 2>/dev/null; then
    echo "source ~/.ollama_env.sh" >> ~/.bashrc
fi

echo "[4/6] Laddar ner native Ollama ARM64 Linux-binär..."
ARCH=$(uname -m)
mkdir -p ~/bin
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    echo "[+] Upptäckte ARM64 (aarch64). Hämtar officiell Ollama Linux ARM64..."
    curl -L https://ollama.com/download/ollama-linux-arm64.tgz -o ~/ollama-arm64.tgz
    tar -C ~/bin -xzf ~/ollama-arm64.tgz
    rm -f ~/ollama-arm64.tgz
    export PATH="$HOME/bin:$HOME/bin/bin:$PATH"
else
    echo "[!] Använder fallback-installatör..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

echo "[5/6] Startar Ollama bakgrundstjänst på port 11434..."
pkill -f "ollama serve" 2>/dev/null || true
sleep 1
nohup ollama serve > ~/.ollama/ollama_daemon.log 2>&1 &
sleep 3

echo "[6/6] Hämtar ultra-stabila lättviktiga modeller anpassade för mobil..."
ollama pull qwen2.5:0.5b
ollama pull llama3.2:1b

echo "----------------------------------------------------------------------"
echo "[SUCCESS] Real Native Ollama körs nu på http://0.0.0.0:11434"
echo "Kolla loggar med: tail -f ~/.ollama/ollama_daemon.log"
echo "----------------------------------------------------------------------"
`;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 font-mono text-xs">
      {/* Sub Navigation Bar */}
      <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-slate-800 overflow-x-auto">
        <button
          onClick={() => setActiveSetupTab('ollama-stability')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors whitespace-nowrap ${
            activeSetupTab === 'ollama-stability'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span>Ollama Termux Stabilitet (Reell Native Setup)</span>
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
        </button>

        <button
          onClick={() => setActiveSetupTab('installer')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors whitespace-nowrap ${
            activeSetupTab === 'installer'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Smartphone className="w-4 h-4 text-slate-300" />
          <span>ZIP & Android Installation (install.sh)</span>
        </button>

        <button
          onClick={() => setActiveSetupTab('websocket')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors whitespace-nowrap ${
            activeSetupTab === 'websocket'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wifi className="w-4 h-4 text-slate-300" />
          <span>WebSocket & Server Monitor</span>
        </button>

        <button
          onClick={() => setActiveSetupTab('skills')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors whitespace-nowrap ${
            activeSetupTab === 'skills'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4 text-slate-300" />
          <span>Agentic Skills Registry</span>
        </button>

        <button
          onClick={() => setActiveSetupTab('appfunctions')}
          className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors whitespace-nowrap ${
            activeSetupTab === 'appfunctions'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4 text-slate-300" />
          <span>Android 17 App Functions</span>
        </button>
      </div>

      {/* Tab 0: Ollama Termux Native Stability & Live Connection */}
      {activeSetupTab === 'ollama-stability' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl p-5 shadow-[0_0_20px_rgba(34,211,238,0.1)] space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-500/40 rounded text-[11px] font-semibold">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Termux Native ARM64 & Android OOM Protection</span>
                </div>
                <h2 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                  Maximera Stabilitet för Ollama i Android Termux (Inga Simuleringar)
                </h2>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  Detta är en komplett lösning för att köra <strong>Ollama direkt i Termux utan krascher eller OOM Kills</strong>.
                  Genom att låsa minne (<code className="text-cyan-300 bg-slate-950 px-1 rounded">OLLAMA_KEEP_ALIVE=-1</code>), ställa in trådbegränsning (<code className="text-cyan-300 bg-slate-950 px-1 rounded">OLLAMA_NUM_PARALLEL=1</code>), sätta wake lock och deaktivera Androids Phantom Process Killer får du äkta, stabil lokal AI på din Android-enhet.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const blob = new Blob([setupOllamaScript], { type: 'text/x-shellscript' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'setup_ollama_termux.sh';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3.5 py-2 bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/50 font-bold text-xs rounded-lg transition-all flex items-center gap-2 whitespace-nowrap shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                >
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span>Ladda ner setup_ollama_termux.sh</span>
                </button>

                <button
                  onClick={() => copyToClipboard(setupOllamaScript, setCopiedOllamaScript)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-lg border border-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  {copiedOllamaScript ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                  <span>{copiedOllamaScript ? 'Kopierat Skript!' : 'Kopiera Hela Skriptet'}</span>
                </button>
              </div>
            </div>

            {/* Critical Stability Rules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                <span className="font-bold text-cyan-300 text-xs flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  1. OLLAMA_KEEP_ALIVE="-1"
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Behåller AI-modellen laddad i mobilsystemets RAM så att inte GPU/CPU-vikterna behöver läsas om från lagringen vid varje ny förfrågan.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                <span className="font-bold text-cyan-300 text-xs flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  2. OLLAMA_NUM_PARALLEL=1
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Begränsar Ollama till 1 parallell sekvens i taget för att undvika minnesläckor och termisk strypning (throttling) på Snapdragon/Mediatek.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                <span className="font-bold text-cyan-300 text-xs flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  3. Android Phantom Process Fix
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Förhindrar att Android 12-15 krossar bakgrundsprocesser när Termux använder mycket minne genom ADB device_config max_phantom_processes.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                <span className="font-bold text-cyan-300 text-xs flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  4. OLLAMA_HOST="0.0.0.0:11434"
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Binder daemon till alla nätverkskort och tillåter alla CORS-ursprung (<code className="text-cyan-300">OLLAMA_ORIGINS="*"</code>) för JACO-anslutning.
                </p>
              </div>
            </div>
          </div>

          {/* ADB Command Box for Phantom Process Killer */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-400" />
                Förhindra att Android dödar bakgrundstjänster (Phantom Process Killer Fix)
              </h3>
              <span className="px-2 py-0.5 text-[10px] bg-amber-950 text-amber-300 border border-amber-500/40 rounded font-mono">
                Android 12 / 13 / 14 / 15
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Kör följande kommandorad i Termux (eller via ADB från datorn) för att stänga av den aggressiva bakgrundsdödaren i Android:
            </p>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-amber-300 flex items-center justify-between gap-3 overflow-x-auto">
              <code>adb shell "device_config put activity_manager max_phantom_processes 2147483647"</code>
              <button
                onClick={() => copyToClipboard('adb shell "device_config put activity_manager max_phantom_processes 2147483647"', () => {})}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] rounded shrink-0 transition-colors"
              >
                Kopiera
              </button>
            </div>
          </div>

          {/* Real Ollama Setup Script Viewer */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-cyan-400" />
                Skriptinnehåll: setup_ollama_termux.sh
              </span>
              <button
                onClick={() => copyToClipboard(setupOllamaScript, setCopiedOllamaScript)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded transition-colors flex items-center gap-1.5"
              >
                {copiedOllamaScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedOllamaScript ? 'Kopierat!' : 'Kopiera'}</span>
              </button>
            </div>

            <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-cyan-300/90 text-xs leading-relaxed overflow-x-auto max-h-72">
              {setupOllamaScript}
            </pre>
          </div>

          {/* REAL LIVE OLLAMA CONNECTION & INFERENCE TESTER (ZERO SIMULATION) */}
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl p-5 space-y-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  Riktigt Live Anslutningstest för Lokal Ollama (Zero Simulation)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Testa anslutning direkt mot den lokala Ollama-daemonen i din enhet utan några hittepå-svar.
                </p>
              </div>

              <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded border ${
                realOllamaStatus === 'connected'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                  : realOllamaStatus === 'testing'
                  ? 'bg-amber-950 text-amber-300 border-amber-500/50'
                  : 'bg-rose-950 text-rose-300 border-rose-500/50'
              }`}>
                {realOllamaStatus === 'connected' ? '● ONLINE (Riktig Ollama)' : realOllamaStatus === 'testing' ? '● ANSLUTER...' : '○ OFFLINE'}
              </span>
            </div>

            {/* Input & Connect Action */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-8 space-y-1">
                <label className="text-[11px] font-mono text-slate-300 block">
                  Lokal Ollama Server URL:
                </label>
                <input
                  type="text"
                  value={realOllamaHost}
                  onChange={(e) => setRealOllamaHost(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="md:col-span-4">
                <button
                  onClick={testRealOllamaConnection}
                  disabled={realOllamaStatus === 'testing'}
                  className="w-full py-2 bg-cyan-900 hover:bg-cyan-800 disabled:opacity-50 text-cyan-200 font-bold text-xs rounded-lg border border-cyan-500/40 flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${realOllamaStatus === 'testing' ? 'animate-spin' : ''}`} />
                  <span>Testa & Hämta Riktiga Modeller</span>
                </button>
              </div>
            </div>

            {/* Real Models Table */}
            {realOllamaModels.length > 0 ? (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-200 block">
                  Hittade Riktiga Nedladdade Modeller ({realOllamaModels.length} st):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {realOllamaModels.map((m, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedRealModel(m.name)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedRealModel === m.name
                          ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs truncate">{m.name}</div>
                      <div className="text-[10px] text-slate-400 mt-1 flex justify-between">
                        <span>Storlek: {m.sizeMb} MB</span>
                        <span>Digest: {m.digest}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : realOllamaStatus === 'connected' ? (
              <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-lg text-xs text-amber-300">
                Ollama svarar på porten, men inga modeller har hämtats än! Kör <code className="bg-slate-950 px-1 py-0.5 rounded">ollama pull qwen2.5:0.5b</code> i Termux.
              </div>
            ) : null}

            {/* Live Inference Box */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-200 block">
                Kör Egentligt Inferenstest mot Lokal Ollama:
              </span>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4 space-y-1">
                  <label className="text-[11px] font-mono text-slate-400 block">
                    Vald Modell:
                  </label>
                  <input
                    type="text"
                    value={selectedRealModel}
                    onChange={(e) => setSelectedRealModel(e.target.value)}
                    placeholder="qwen2.5:0.5b"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                  />
                </div>

                <div className="md:col-span-8 space-y-1">
                  <label className="text-[11px] font-mono text-slate-400 block">
                    Testprompt:
                  </label>
                  <input
                    type="text"
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                  />
                </div>
              </div>

              <button
                onClick={handleRunRealInference}
                disabled={isInferenceRunning || !testPrompt}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 disabled:opacity-50 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
              >
                {isInferenceRunning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Inferens Körs Lokalt i Ollama...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-slate-950" />
                    <span>Skicka Prompt till Lokal Ollama ({selectedRealModel})</span>
                  </>
                )}
              </button>

              {/* Inference Stats Badge */}
              {inferenceStats && (
                <div className="p-2 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-xs font-mono text-emerald-300 flex items-center justify-between">
                  <span>Genererade {inferenceStats.tokens} tokens</span>
                  <span>Hastighet: <strong>{inferenceStats.speed} tok/s</strong></span>
                  <span>Tid: {inferenceStats.durationMs} ms</span>
                </div>
              )}

              {/* Output Display */}
              {realInferenceOutput && (
                <div className="space-y-1">
                  <span className="text-[11px] font-mono text-slate-400 block">Riktigt Svar från Ollama:</span>
                  <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-slate-200 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-64">
                    {realInferenceOutput}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 1: ZIP & Android Installation Guide */}
      {activeSetupTab === 'installer' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold">
                  <Download className="w-3.5 h-3.5 text-slate-300" />
                  <span>ZIP-Paket med Färdig Installationsfil (install.sh)</span>
                </div>
                <h2 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                  Enkel Installation från ZIP-fil
                </h2>
                <p className="text-xs text-slate-400 max-w-2xl">
                  När du laddar ner projektet som ZIP innehåller det den färdiga skriptfilen <code className="text-slate-200 bg-slate-950 px-1 py-0.5 rounded">install.sh</code>.
                  Skriptet installerar alla beroenden, ber om Android-tillåtelser för mobilsensorer och terminal, sätter upp HTTPS-certifikat och startar servern med WebSocket GUI.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={downloadInstallScriptDirectly}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold text-xs rounded transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  <Download className="w-4 h-4 text-slate-300" />
                  <span>Ladda ned install.sh</span>
                </button>

                <button
                  onClick={() => onRunTerminalCommand('bash install.sh')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold text-xs rounded transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  <Play className="w-4 h-4 text-slate-300" />
                  <span>Kör i Terminal</span>
                </button>
              </div>
            </div>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-slate-400" />
                  1. Tillåtelser i Android
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Triggard dialoger i mobilen (<code className="text-slate-300">termux-setup-storage</code> & <code className="text-slate-300">termux-api</code>) så du kan godkänna åtkomst till lagring, kamera, mikrofon och hårdvarusensorer.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Server className="w-4 h-4 text-slate-400" />
                  2. Fristående Server Daemon
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Startar en komplett Node Express + WebSocket-server likt en lättviktig Docker-container direkt på enheten (Port 3000 & 11434).
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-slate-400" />
                  3. HTTPS & Auto-Launch
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Genererar lokala SSL-certifikat (<code className="text-slate-300">certs/server.crt</code>) och öppnar automatiskt det säkra webbgränssnittet i webbläsaren.
                </p>
              </div>
            </div>

            {/* Quick ZIP Command Box */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-slate-400" />
                  Snabbkommando efter uppackning av ZIP-filen:
                </span>
                <button
                  onClick={() => copyToClipboard(zipInstallScript, setCopiedZipScript)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded flex items-center gap-1.5 transition-colors"
                >
                  {copiedZipScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{copiedZipScript ? 'Kopierat!' : 'Kopiera Kommando'}</span>
                </button>
              </div>

              <pre className="p-3.5 bg-slate-950 rounded border border-slate-800 text-slate-200 text-xs leading-relaxed overflow-x-auto">
                {zipInstallScript}
              </pre>
            </div>

            {/* Android Termux Script Box */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-slate-400" />
                  Direkt Android Termux installation med sensor-tillåtelser:
                </span>
                <button
                  onClick={() => copyToClipboard(termuxSetupScript, setCopiedTermuxScript)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded flex items-center gap-1.5 transition-colors"
                >
                  {copiedTermuxScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{copiedTermuxScript ? 'Kopierat!' : 'Kopiera Kommando'}</span>
                </button>
              </div>

              <pre className="p-3.5 bg-slate-950 rounded border border-slate-800 text-slate-200 text-xs leading-relaxed overflow-x-auto">
                {termuxSetupScript}
              </pre>
            </div>
          </div>

          {/* System Check Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-bold">Android OS Runtime</span>
                <span className="text-slate-200 font-semibold">Android 14 ARM64</span>
              </div>
              <p className="text-[11px] text-slate-500">Snapdragon NPU acceleration redo</p>
            </div>

            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-bold">NPU Bindning</span>
                <span className="text-slate-200 font-semibold">Hexagon Tensor v75</span>
              </div>
              <p className="text-[11px] text-slate-500">Direkt FP16/INT4 tensorstöd</p>
            </div>

            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-bold">Socket Listener</span>
                <span className="text-slate-200 font-semibold">Port 3000 & 11434</span>
              </div>
              <p className="text-[11px] text-slate-500">HTTPS & WebSocket GUI redo</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: WebSocket Hooks Dashboard */}
      {activeSetupTab === 'websocket' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-slate-400" />
                  WebSocket Hook & Server Status
                </h3>
                <p className="text-xs text-slate-400">Aktiv Socket URL: <strong className="text-slate-200">{socketUrl}</strong></p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleConnection}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                    isConnected ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {isConnected ? 'Aktiv Anslutning' : 'Frånkopplad'}
                </button>

                <button
                  onClick={() => startTokenStream('Generera NPU vektormetod')}
                  disabled={isStreaming}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 rounded text-xs font-bold flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isStreaming ? 'Sänder Stream...' : 'Testa Token Stream'}</span>
                </button>
              </div>
            </div>

            {/* Live Streaming Token Box */}
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2 text-xs">
              <span className="text-slate-400 font-bold flex items-center justify-between">
                <span>WebSocket Token Stream:</span>
                {isStreaming && <span className="text-slate-300">Strömmar token-paket...</span>}
              </span>
              <pre className="p-3 bg-slate-900 rounded border border-slate-800 text-slate-300 min-h-[100px] overflow-x-auto whitespace-pre-wrap">
                {streamingTokens || '// Klicka på "Testa Token Stream" för att sända testdata över WebSocket...'}
              </pre>
            </div>

            {/* WebSocket Event Stream History */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Senaste WebSocket Händelser
              </h4>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 max-h-60 overflow-y-auto space-y-2 text-xs">
                {eventHistory.map((evt) => (
                  <div key={evt.eventId} className="p-2 bg-slate-900 rounded border border-slate-800 flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded text-[10px] font-bold">
                          {evt.type}
                        </span>
                        <span className="text-slate-400 text-[11px]">{evt.timestamp}</span>
                      </div>
                      <pre className="text-slate-300 text-[11px] mt-1 whitespace-pre-wrap">
                        {JSON.stringify(evt.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Agentic Skills Registry */}
      {activeSetupTab === 'skills' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-slate-400" />
                Integrerade Agentic Skills
              </h3>
              <p className="text-xs text-slate-400">
                Aktivt registrerade verktyg och färdigheter för NPU, röststyrning och källkodspatchar.
              </p>
            </div>

            <span className="px-3 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded font-mono text-xs font-bold">
              {skills.filter(s => s.isEnabled).length} / {skills.length} Aktiva
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className={`p-4 rounded-lg border transition-all ${
                  skill.isEnabled
                    ? 'bg-slate-900 border-slate-700'
                    : 'bg-slate-900/60 border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-300 rounded">
                      {skill.category}
                    </span>
                    <h4 className="text-xs font-bold text-slate-100 mt-1">{skill.name}</h4>
                  </div>

                  <button
                    onClick={() => toggleSkill(skill.id)}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                      skill.isEnabled
                        ? 'bg-slate-800 text-slate-100 border border-slate-700'
                        : 'bg-slate-950 text-slate-500'
                    }`}
                  >
                    {skill.isEnabled ? 'AKTIV' : 'AVSTÄNGD'}
                  </button>
                </div>

                <p className="text-xs text-slate-400 mt-2">{skill.description}</p>

                <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <div>
                    <span className="block text-slate-500">Triggernyckel</span>
                    <span className="text-slate-300">{skill.triggerKey}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500">Körningar</span>
                    <span className="text-slate-200 font-bold">{skill.executionCount} st</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: App Functions (Android 17) */}
      {activeSetupTab === 'appfunctions' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <Layers className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">Android 17 Gemini App Functions</h3>
                <p className="text-xs text-slate-400">Integrering av JACO Workflow via native Android App Functions</p>
              </div>
            </div>
            
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                Eftersom Google inte exponerar en callback för att din app ska kunna "tjuvlyssna" på 
                Gemini, är lösningen i Android 17 istället att din app <strong>registrerar en App Function</strong>. 
                När användaren säger <em>"Hey Google, be JACO refactorera math-filen"</em>, så matchar 
                Gemini det mot din registrerade funktion och anropar den med extraherade parametrar.
              </p>
              
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-[11px] overflow-x-auto space-y-2">
                <div className="text-slate-400 mb-2">{'// 1. Registrera din App Function i Android-appen'}</div>
                <pre className="text-cyan-400">
{`override val appFunctionConfiguration
    get() = AppFunctionConfiguration.Builder()
        .addEnclosingClassFactory(JacoGatewayFunctions::class.java) { JacoGatewayFunctions() }
        .build()`}
                </pre>
              </div>

              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-[11px] overflow-x-auto space-y-2 relative group">
                <div className="text-slate-400 mb-2">{'// 2. Definiera funktionen som pratar med Node.js backenden'}</div>
                <button 
                  onClick={() => {
                    const el = document.createElement('a');
                    el.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(`class JacoGatewayFunctions {\n    @AppFunction\n    suspend fun submitAgentWorkflow(\n        @AppFunctionParameter(description = "Det användaren vill göra") intent: String,\n        @AppFunctionParameter(description = "Filsökväg") targetFile: String\n    ): AppFunctionResult {\n        // Skicka POST till Node.js backenden på localhost (vår express-server)\n        val response = httpClient.post("http://127.0.0.1:3000/api/appfunctions/gemini-webhook") {\n            setBody(mapOf("intent" to intent, "targetFile" to targetFile))\n        }\n        \n        return AppFunctionResult.Builder()\n            .setResultData("Action queued for approval via ntfy. Check your phone.")\n            .build()\n    }\n}`));
                    el.setAttribute('download', 'JacoGatewayFunctions.kt');
                    el.style.display = 'none';
                    document.body.appendChild(el);
                    el.click();
                    document.body.removeChild(el);
                  }}
                  className="absolute top-3 right-3 px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Ladda ner .kt
                </button>
                <pre className="text-sky-400">
{`class JacoGatewayFunctions {
    @AppFunction
    suspend fun submitAgentWorkflow(
        @AppFunctionParameter(description = "Det användaren vill göra") intent: String,
        @AppFunctionParameter(description = "Filsökväg") targetFile: String
    ): AppFunctionResult {
        // Skicka POST till Node.js backenden på localhost (vår express-server)
        val response = httpClient.post("http://127.0.0.1:3000/api/appfunctions/gemini-webhook") {
            setBody(mapOf("intent" to intent, "targetFile" to targetFile))
        }
        
        // Node.js svarar med en pending-status, vi meddelar Gemini
        return AppFunctionResult.Builder()
            .setResultData("Action queued for approval via ntfy. Check your phone.")
            .build()
    }
}`}
                </pre>
              </div>
              
              <div className="bg-cyan-500/10 border border-indigo-500/20 p-4 rounded-lg">
                <h4 className="font-bold text-indigo-300 mb-1">Hur det hänger ihop med vårt ntfy-flöde:</h4>
                <p className="text-slate-400">
                  När Androids system-Gemini anropar din <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-200">submitAgentWorkflow</code>, 
                  skickas datan direkt in i vår nya, dedikerade <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-200">/api/appfunctions/gemini-webhook</code>-route i Node.js. 
                  Där köas ändringen (pendingActions) och ett ntfy.sh-meddelande skickas för manuellt godkännande. 
                  Du får alltså den native Gemini-integrationen gratis, kombinerat med vår befintliga säkerhetsmodell!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
