import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Cpu, Zap, Activity, Flame, ShieldAlert, Sparkles, RefreshCw, Play, Pause } from 'lucide-react';

interface TelemetryPoint {
  time: number; // relative seconds
  npu: number;  // 0 - 100%
  gpu: number;  // 0 - 100%
  cpu: number;  // 0 - 100%
  temp: number; // C
  tps: number;  // tokens/sec
}

export const LiteRTTelemetryChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [mode, setMode] = useState<'litert' | 'ollama'>('litert');
  const [isLive, setIsLive] = useState(true);
  
  // Data buffer of historical points
  const [data, setData] = useState<TelemetryPoint[]>(() => {
    const initial: TelemetryPoint[] = [];
    const now = Date.now();
    for (let i = 20; i >= 0; i--) {
      initial.push({
        time: (now - i * 1000) / 1000,
        npu: 82 + (Math.sin(i) * 6),
        gpu: 65 + (Math.cos(i) * 5),
        cpu: 18 + (Math.sin(i * 0.5) * 4),
        temp: 36.2,
        tps: 22.4
      });
    }
    return initial;
  });

  // Current stats derived from latest point
  const current = data[data.length - 1] || { npu: 0, gpu: 0, cpu: 0, temp: 0, tps: 0 };

  // Generate next data point based on active mode
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      setData(prev => {
        const last = prev[prev.length - 1];
        const nextTime = (Date.now()) / 1000;
        
        let newNpu = 0;
        let newGpu = 0;
        let newCpu = 0;
        let newTemp = 36.0;
        let newTps = 22.0;

        if (mode === 'litert') {
          // LiteRT-LM mode: Heavy NPU & GPU delegate usage, very low CPU
          newNpu = Math.min(98, Math.max(70, (last ? last.npu : 80) + (Math.random() * 8 - 4)));
          newGpu = Math.min(85, Math.max(50, (last ? last.gpu : 65) + (Math.random() * 6 - 3)));
          newCpu = Math.min(30, Math.max(12, (last ? last.cpu : 18) + (Math.random() * 4 - 2)));
          newTemp = Math.min(38, Math.max(35.5, (last ? last.temp : 36) + (Math.random() * 0.2 - 0.1)));
          newTps = Math.min(26, Math.max(19, (last ? last.tps : 22) + (Math.random() * 1.5 - 0.75)));
        } else {
          // Ollama CPU mode: 0% NPU, ~5% GPU, 85-98% CPU throttling & heating up
          newNpu = Math.min(5, Math.max(0, (last ? last.npu : 2) + (Math.random() * 2 - 1)));
          newGpu = Math.min(10, Math.max(0, (last ? last.gpu : 4) + (Math.random() * 2 - 1)));
          newCpu = Math.min(99, Math.max(78, (last ? last.cpu : 88) + (Math.random() * 8 - 4)));
          newTemp = Math.min(46, Math.max(40, (last ? last.temp : 42) + (Math.random() * 0.3 - 0.1))); // Rising temp
          newTps = Math.min(6.5, Math.max(3.2, (last ? last.tps : 4.8) + (Math.random() * 0.8 - 0.4)));
        }

        const nextPoint: TelemetryPoint = {
          time: nextTime,
          npu: Math.round(newNpu * 10) / 10,
          gpu: Math.round(newGpu * 10) / 10,
          cpu: Math.round(newCpu * 10) / 10,
          temp: Math.round(newTemp * 10) / 10,
          tps: Math.round(newTps * 10) / 10
        };

        const updated = [...prev.slice(1), nextPoint];
        return updated;
      });
    }, 800);

    return () => clearInterval(interval);
  }, [isLive, mode]);

  // Render D3 chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const width = containerRef.current.clientWidth || 600;
    const height = 240;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('width', width).attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X Scale
    const xScale = d3.scaleLinear()
      .domain([0, data.length - 1])
      .range([0, innerWidth]);

    // Y Scale
    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0]);

    // Grid lines
    const yGrid = d3.axisLeft(yScale)
      .tickSize(-innerWidth)
      .tickFormat(() => '')
      .ticks(5);

    g.append('g')
      .attr('class', 'grid')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '3,3');

    // Axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(6)
      .tickFormat((d) => `-${(data.length - 1 - (d as number)) * 0.8}s`);

    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat(d => `${d}%`);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .attr('color', '#64748b')
      .attr('font-family', 'monospace')
      .attr('font-size', '10px');

    g.append('g')
      .call(yAxis)
      .attr('color', '#64748b')
      .attr('font-family', 'monospace')
      .attr('font-size', '10px');

    // Line Generators
    const lineNpu = d3.line<TelemetryPoint>()
      .x((_, i) => xScale(i))
      .y(d => yScale(d.npu))
      .curve(d3.curveMonotoneX);

    const lineGpu = d3.line<TelemetryPoint>()
      .x((_, i) => xScale(i))
      .y(d => yScale(d.gpu))
      .curve(d3.curveMonotoneX);

    const lineCpu = d3.line<TelemetryPoint>()
      .x((_, i) => xScale(i))
      .y(d => yScale(d.cpu))
      .curve(d3.curveMonotoneX);

    // Area gradients
    const defs = svg.append('defs');

    // NPU Gradient
    const npuGrad = defs.append('linearGradient')
      .attr('id', 'npu-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    npuGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.25);
    npuGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    // CPU Gradient
    const cpuGrad = defs.append('linearGradient')
      .attr('id', 'cpu-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    cpuGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.25);
    cpuGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.0);

    // Draw Areas
    const areaNpu = d3.area<TelemetryPoint>()
      .x((_, i) => xScale(i))
      .y0(innerHeight)
      .y1(d => yScale(d.npu))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'url(#npu-grad)')
      .attr('d', areaNpu);

    // Draw Lines
    // 1. CPU Line (Rose)
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#f43f5e')
      .attr('stroke-width', 2)
      .attr('d', lineCpu);

    // 2. GPU Line (Cyan)
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#06b6d4')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', mode === 'ollama' ? '4,4' : 'none')
      .attr('d', lineGpu);

    // 3. NPU Line (Emerald)
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2.5)
      .attr('d', lineNpu);

    // Draw Dots on last point
    const lastIdx = data.length - 1;
    const lastP = data[lastIdx];

    if (lastP) {
      // NPU Dot
      g.append('circle')
        .attr('cx', xScale(lastIdx))
        .attr('cy', yScale(lastP.npu))
        .attr('r', 4)
        .attr('fill', '#10b981')
        .attr('stroke', '#022c22')
        .attr('stroke-width', 2);

      // GPU Dot
      g.append('circle')
        .attr('cx', xScale(lastIdx))
        .attr('cy', yScale(lastP.gpu))
        .attr('r', 4)
        .attr('fill', '#06b6d4')
        .attr('stroke', '#083344')
        .attr('stroke-width', 2);

      // CPU Dot
      g.append('circle')
        .attr('cx', xScale(lastIdx))
        .attr('cy', yScale(lastP.cpu))
        .attr('r', 4)
        .attr('fill', '#f43f5e')
        .attr('stroke', '#4c0519')
        .attr('stroke-width', 2);
    }

  }, [data, mode]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
      {/* Chart Header & Control Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">D3 Realtime Telemetry: Nemotron 4B på Pixel 10 Pro</h3>
          </div>
          <p className="text-slate-400 text-[11px] mt-0.5">
            Exekvering av NVIDIA Nemotron 4B via LiteRT-LM (Tensor AI Core / Vulkan GPU) vs Ollama CPU Fallback
          </p>
        </div>

        {/* Mode Selector Toggle */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setIsLive(!isLive)}
            className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            title={isLive ? 'Pausa telemetri' : 'Starta telemetri'}
          >
            {isLive ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
          </button>

          <div className="bg-slate-900 p-1 border border-slate-800 rounded-lg flex gap-1">
            <button
              onClick={() => setMode('litert')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'litert'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-indigo-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-cyan-300" />
              LiteRT (GPU/NPU)
            </button>
            <button
              onClick={() => setMode('ollama')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'ollama'
                  ? 'bg-rose-950 border border-rose-800 text-rose-300 shadow-lg shadow-rose-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3 h-3 text-rose-400" />
              Ollama (CPU Only)
            </button>
          </div>
        </div>
      </div>

      {/* Realtime KPI Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
        <div className="bg-slate-900/80 border border-emerald-900/50 p-2.5 rounded-lg">
          <div className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Pixel 10 NPU
          </div>
          <div className="text-lg font-bold text-emerald-300 mt-0.5">{current.npu}%</div>
          <div className="text-[9px] text-slate-500">Tensor AI Core</div>
        </div>

        <div className="bg-slate-900/80 border border-cyan-900/50 p-2.5 rounded-lg">
          <div className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            Vulkan GPU
          </div>
          <div className="text-lg font-bold text-cyan-300 mt-0.5">{current.gpu}%</div>
          <div className="text-[9px] text-slate-500">Adreno/Mali GPU</div>
        </div>

        <div className="bg-slate-900/80 border border-rose-900/50 p-2.5 rounded-lg">
          <div className="text-[10px] text-rose-400 font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            CPU Cores
          </div>
          <div className="text-lg font-bold text-rose-300 mt-0.5">{current.cpu}%</div>
          <div className="text-[9px] text-slate-500">ARM Cortex</div>
        </div>

        <div className="bg-slate-900/80 border border-amber-900/50 p-2.5 rounded-lg">
          <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
            <Flame className="w-3 h-3" />
            Temperatur
          </div>
          <div className={`text-lg font-bold mt-0.5 ${current.temp > 40 ? 'text-rose-400' : 'text-amber-300'}`}>
            {current.temp}°C
          </div>
          <div className="text-[9px] text-slate-500">{current.temp > 40 ? 'Throttling Risk' : 'Optimal'}</div>
        </div>

        <div className="bg-slate-900/80 border border-indigo-900/50 p-2.5 rounded-lg col-span-2 sm:col-span-1">
          <div className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Tokens / sek
          </div>
          <div className="text-lg font-bold text-cyan-200 mt-0.5">{current.tps} t/s</div>
          <div className="text-[9px] text-slate-500">Inference Throughput</div>
        </div>
      </div>

      {/* D3 SVG Container */}
      <div ref={containerRef} className="w-full bg-slate-900/50 border border-slate-800/80 rounded-xl p-2 relative overflow-hidden">
        <svg ref={svgRef} className="w-full overflow-visible" />

        {/* Legend Overlay */}
        <div className="flex items-center justify-end gap-4 mt-2 px-2 text-[10px] font-mono text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-400 rounded-full" />
            <span>NPU (Tensor)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 rounded-full" />
            <span>GPU (Vulkan)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-rose-400 rounded-full" />
            <span>CPU (Cortex)</span>
          </div>
        </div>
      </div>

      {/* Status Commentary Footer */}
      <div className={`p-3 rounded-lg text-xs font-mono border flex items-center gap-2.5 ${
        mode === 'litert'
          ? 'bg-cyan-950/40 border-emerald-800/60 text-emerald-300'
          : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
      }`}>
        {mode === 'litert' ? (
          <>
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Nemotron 4B på LiteRT-LM:</strong> Tensor AI Core & GPU driver Nemotron 4B med full NPU-acceleration. CPU-belastningen är låg ({current.cpu}%), temperaturen förblir sval ({current.temp}°C) och hastigheten är hög ({current.tps} t/s).
            </span>
          </>
        ) : (
          <>
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <strong>Nemotron 4B på Ollama CPU Fallback:</strong> CPU-kärnorna kör på max ({current.cpu}%) utan NPU-delegat, vilket ger hög temperatur ({current.temp}°C), batteridränering och långsam generering ({current.tps} t/s).
            </span>
          </>
        )}
      </div>
    </div>
  );
};
