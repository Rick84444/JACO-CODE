import React, { useState } from 'react';
import { Cpu, Zap, Activity, Code2, Play, GitMerge, FileCode2, PackageOpen, Layers, CheckCircle2, ChevronRight, Check } from 'lucide-react';
import { LiteRTTelemetryChart } from './LiteRTTelemetryChart';

export const LiteRTMigration: React.FC = () => {
  const [activeSection, setActiveSection] = useState<'architecture' | 'implementation' | 'benchmark' | 'roadmap'>('architecture');

  const getTabClass = (section: string) => `
    flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer
    ${activeSection === section 
      ? 'border-cyan-400 text-indigo-300 bg-cyan-950/40' 
      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'}
  `;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 font-mono">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-950 border border-indigo-500/50 flex items-center justify-center">
            <Zap className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-100 tracking-tight">LiteRT-LM Integration</h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Nativ Android-infernns med Google LiteRT-LM (f.d. TFLite). Byter från CPU-bunden Ollama till GPU/NPU accelererad exekvering på Google Pixel 10 Pro.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex overflow-x-auto border-b border-slate-800 bg-slate-950/50 rounded-t-xl">
        <div className={getTabClass('architecture')} onClick={() => setActiveSection('architecture')}>
          <Layers className="w-4 h-4" /> Arkitektur
        </div>
        <div className={getTabClass('implementation')} onClick={() => setActiveSection('implementation')}>
          <Code2 className="w-4 h-4" /> Implementation
        </div>
        <div className={getTabClass('benchmark')} onClick={() => setActiveSection('benchmark')}>
          <Activity className="w-4 h-4" /> Riktmärken (Benchmarks)
        </div>
        <div className={getTabClass('roadmap')} onClick={() => setActiveSection('roadmap')}>
          <GitMerge className="w-4 h-4" /> Migration & Roadmap
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-b-xl rounded-tr-xl p-6">
        
        {/* ARCHITECTURE SECTION */}
        {activeSection === 'architecture' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <h2 className="text-lg font-bold text-indigo-300 mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5" /> Target Architecture
              </h2>
              
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 relative">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-bold w-64 text-center z-10 shadow-lg">
                    JACO GUI
                  </div>
                  <div className="h-6 border-l-2 border-indigo-500/50 border-dashed" />
                  
                  <div className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-bold w-64 text-center z-10 shadow-lg">
                    Mission Manager
                  </div>
                  <div className="h-6 border-l-2 border-indigo-500/50 border-dashed" />
                  
                  <div className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-bold w-64 text-center z-10 shadow-lg">
                    Tool Router
                  </div>
                  <div className="h-6 border-l-2 border-indigo-500/50 border-dashed" />
                  
                  <div className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-bold w-64 text-center z-10 shadow-lg">
                    Memory
                  </div>
                  <div className="h-6 border-l-2 border-indigo-500/50 border-dashed" />
                  
                  <div className="px-6 py-4 bg-cyan-950 border border-indigo-500/60 rounded-xl text-cyan-200 font-bold w-80 text-center z-10 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                    LiteRT-LM Runtime
                    <div className="text-[10px] text-cyan-400 mt-1 font-normal tracking-wide uppercase">C++ / Kotlin Native Backend</div>
                  </div>
                  
                  <div className="flex w-80 justify-center gap-12 mt-2">
                    <div className="h-8 border-l-2 border-emerald-500/50 border-dashed transform -rotate-[20deg] origin-top" />
                    <div className="h-8 border-l-2 border-cyan-500/50 border-dashed transform rotate-[20deg] origin-top" />
                  </div>
                  
                  <div className="flex w-full justify-center gap-6 mt-2">
                    <div className="px-4 py-3 bg-cyan-950 border border-emerald-800 rounded-lg text-emerald-300 font-bold w-40 text-center shadow-[0_0_15px_rgba(16,185,129,0.15)] flex flex-col items-center">
                      <Cpu className="w-5 h-5 mb-1" />
                      Tensor AI Core
                      <span className="text-[9px] block text-emerald-500 mt-1 uppercase">Pixel 10 NPU</span>
                    </div>
                    <div className="px-4 py-3 bg-cyan-950 border border-cyan-800 rounded-lg text-cyan-300 font-bold w-40 text-center shadow-[0_0_15px_rgba(6,182,212,0.15)] flex flex-col items-center">
                      <Zap className="w-5 h-5 mb-1" />
                      GPU Delegate
                      <span className="text-[9px] block text-cyan-500 mt-1 uppercase">OpenCL/Vulkan</span>
                    </div>
                  </div>
                  
                  <div className="h-6 border-l-2 border-indigo-500/50 border-dashed mt-4" />
                  <div className="px-6 py-2 bg-slate-800/80 border border-slate-700/80 rounded-full text-slate-300 text-xs flex items-center gap-2">
                    <Play className="w-3 h-3 text-cyan-400" />
                    Streaming Response (Tokens)
                  </div>
                </div>
              </div>
            </section>
            
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-bold text-slate-300 border-b border-slate-800 pb-2">Supported Models (LiteRT format)</h3>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Gemma 2/3 (2B, 4B)</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Qwen 2.5 (1.5B, 3B)</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Phi-3 Mini</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Llama 3.2 (1B, 3B)</li>
                </ul>
              </div>
              <div className="space-y-3">
                <h3 className="font-bold text-slate-300 border-b border-slate-800 pb-2">Execution Backends</h3>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-start gap-2">
                    <span className="bg-emerald-900/50 text-cyan-400 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5">NPU</span>
                    <span><strong>Tensor AI Core:</strong> Optimized for INT4/INT8 quantized Gemma models on Pixel devices. Lowest power.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-cyan-900/50 text-cyan-400 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5">GPU</span>
                    <span><strong>Vulkan Delegate:</strong> High performance for FP16 weights. High throughput, moderate power.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5">CPU</span>
                    <span><strong>XNNPACK:</strong> Fallback backend. High power draw, thermal throttling risk.</span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        )}

        {/* IMPLEMENTATION SECTION */}
        {activeSection === 'implementation' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <PackageOpen className="w-4 h-4 text-cyan-400" /> Gradle Konfiguration (app/build.gradle.kts)
                </h3>
                <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded font-mono">
                  Android Build-fil (Ej Bash)
                </span>
              </div>
              <p className="text-slate-400 text-xs mb-2">
                Lägg till dessa beroenden i din Android Studio / Gradle-byggfil för att inkludera LiteRT-LM & MediaPipe i Android-appen:
              </p>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-xs text-indigo-300 overflow-x-auto">
{`dependencies {
    // MediaPipe Tasks (som kapslar in LiteRT-LM för Android)
    implementation("com.google.mediapipe:tasks-genai:0.10.14")
    
    // Core LiteRT om du skriver kundanpassade delegates
    implementation("com.google.mlkit:play-services-mlkit-text-recognition:19.0.0")
    
    // Coroutines för asynkron token-streamning
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}`}
              </pre>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-cyan-400" /> Kotlin Implementation (LlmInference.kt)
                </h3>
                <span className="text-[10px] bg-cyan-950 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded font-mono">
                  Kotlin Källkod
                </span>
              </div>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-[11px] text-emerald-300 overflow-x-auto">
{`import com.google.mediapipe.tasks.genai.llminference.LlmInference
import kotlinx.coroutines.flow.MutableSharedFlow

class JacoLiteRTRuntime(private val context: Context) {
    private var llmInference: LlmInference? = null
    val tokenStream = MutableSharedFlow<String>()

    fun initializeModel(modelPath: String) {
        val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(modelPath)
            .setMaxTokens(1024)
            .setResultListener { partialResult, done ->
                // Streama token direkt till JACO UI
                tokenStream.tryEmit(partialResult)
            }
            .build()
            
        llmInference = LlmInference.createFromOptions(context, options)
    }

    suspend fun generateResponse(prompt: String) {
        llmInference?.generateResponseAsync(prompt)
    }
    
    fun close() {
        llmInference?.close()
    }
}`}
              </pre>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-slate-400" /> AndroidManifest.xml inställningar
                </h3>
                <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded font-mono">
                  XML Konfiguration
                </span>
              </div>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-xs text-slate-300 overflow-x-auto">
{`<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Nödvändigt för nedladdning/synkning av AI-modeller -->
    <uses-permission android:name="android.permission.INTERNET" />
    
    <!-- Krävs för att fråga efter OpenCL/Vulkan GPU-kapacitet -->
    <uses-feature android:glEsVersion="0x00030002" android:required="true" />
    
    <application
        android:hardwareAccelerated="true"
        android:largeHeap="true">
        ...
    </application>
</manifest>`}
              </pre>
            </section>
          </div>
        )}

        {/* BENCHMARK SECTION */}
        {activeSection === 'benchmark' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* D3 Realtime Telemetry Chart */}
            <LiteRTTelemetryChart />

            <p className="text-slate-400 text-sm">
              Förväntade mätvärden baserade på övergång från CPU-bunden Ollama till native GPU/NPU accelererad LiteRT-LM på Google Pixel 10 Pro (Tensor SoC).
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/50">
                    <th className="p-3 font-semibold text-slate-300">Mätvärde</th>
                    <th className="p-3 font-semibold text-slate-300">Nuvarande (Ollama CPU)</th>
                    <th className="p-3 font-semibold text-cyan-400">Target (LiteRT GPU/NPU)</th>
                    <th className="p-3 font-semibold text-cyan-400">Förbättring</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  <tr className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400">Tokens/sec (Gemma 2B)</td>
                    <td className="p-3 text-slate-300">4 - 6 t/s</td>
                    <td className="p-3 text-cyan-300">18 - 25 t/s</td>
                    <td className="p-3 text-cyan-400 font-bold">~400% Snabbare</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400">First-Token Latency</td>
                    <td className="p-3 text-slate-300">2.5 - 4.0 sek</td>
                    <td className="p-3 text-cyan-300">0.3 - 0.6 sek</td>
                    <td className="p-3 text-cyan-400 font-bold">-80% Fördröjning</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400">Device Temperature</td>
                    <td className="p-3 text-rose-400">42°C - 45°C (Thermal Throttle)</td>
                    <td className="p-3 text-cyan-300">35°C - 38°C</td>
                    <td className="p-3 text-cyan-400 font-bold">Stabil</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400">Power Usage (Drain)</td>
                    <td className="p-3 text-rose-400">Hög (7-9W)</td>
                    <td className="p-3 text-cyan-300">Låg/Medel (2-4W på NPU)</td>
                    <td className="p-3 text-cyan-400 font-bold">-50% Batteriförbrukning</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="p-3 text-slate-400">RAM Allocation</td>
                    <td className="p-3 text-slate-300">4.5 GB (Ostrukturerad)</td>
                    <td className="p-3 text-cyan-300">2.2 GB (Memory Mapped)</td>
                    <td className="p-3 text-cyan-400 font-bold">Effektiv RAM-hantering</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="bg-cyan-950/30 border border-indigo-900/50 rounded-lg p-4 text-xs text-cyan-200">
              <strong className="text-cyan-400 font-bold">Analys:</strong> CPU-bunden inference tvingar alla Cortex-kärnor att arbeta maximalt, vilket leder till omedelbar värmeutveckling och termisk strypning (thermal throttling). Genom att flytta matris-multiplikationen till GPU eller Tensor AI Core (NPU) minskar strömförbrukningen drastiskt samtidigt som genomströmningen ökar, vilket är kritiskt för en Companion-app som kräver "always-on" funktionalitet.
            </div>
          </div>
        )}

        {/* ROADMAP SECTION */}
        {activeSection === 'roadmap' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="relative border-l border-slate-700 ml-4 space-y-8 pb-4">
              
              <div className="relative">
                <div className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <div className="ml-4">
                  <h4 className="text-sm font-bold text-cyan-400">Fas 1: Teknisk Proof-of-Concept</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-2">Konvertering och initial testning på Pixel-hårdvara.</p>
                  <ul className="text-[11px] text-slate-300 space-y-1">
                    <li className="flex items-start gap-1"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Kompilera en int4-kvantiserad Gemma 3-modell (2B) till <code>.task</code> / <code>.tflite</code> format.</li>
                    <li className="flex items-start gap-1"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Integrera <code>com.google.mediapipe:tasks-genai</code> i ett test-projekt.</li>
                    <li className="flex items-start gap-1"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Bekräfta att MediaPipe allokerar GPU-delegaten och inte faller tillbaka till CPU.</li>
                  </ul>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                <div className="ml-4">
                  <h4 className="text-sm font-bold text-cyan-400">Fas 2: Integration i JACO Companion</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-2">Bygga broar mellan UI och Native Inference.</p>
                  <ul className="text-[11px] text-slate-300 space-y-1">
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" /> Ersätt HTTP-anrop mot localhost:11434 (Ollama) med JNI / Kotlin Channels för native inference.</li>
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" /> Implementera <code>MutableSharedFlow</code> för asynkron streamning av tokens till chat-gränssnittet.</li>
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" /> Skriv en Adapter-klass för att matcha befintlig Tool Router-funktionalitet.</li>
                  </ul>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-slate-600" />
                <div className="ml-4">
                  <h4 className="text-sm font-bold text-slate-300">Fas 3: NPU & Memory Management</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-2">Optimering för Pixel 10 Tensor AI Core.</p>
                  <ul className="text-[11px] text-slate-500 space-y-1">
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 shrink-0" /> Tvinga inference till NPU via <code>NnApiDelegate</code> om stöds.</li>
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 shrink-0" /> Hantera context window limits (vanligtvis begränsat till ~1024-2048 i LiteRT för mobilt) genom sliding-window memory i JACO.</li>
                  </ul>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-slate-600" />
                <div className="ml-4">
                  <h4 className="text-sm font-bold text-slate-300">Fas 4: Ollama Deprecation</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-2">Fasa ut den gamla miljön.</p>
                  <ul className="text-[11px] text-slate-500 space-y-1">
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 shrink-0" /> Ta bort Termux-beroenden för att driva AI-server.</li>
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 shrink-0" /> Minska APK-storleken och ta bort onödiga bakgrundsprocesser.</li>
                    <li className="flex items-start gap-1"><ChevronRight className="w-3.5 h-3.5 shrink-0" /> Släpp JACO 2.0 Native Runtime release.</li>
                  </ul>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
};
