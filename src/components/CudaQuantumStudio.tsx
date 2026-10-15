import React, { useState, useEffect, useRef } from 'react';
import { Atom, Cpu, Play, Sparkles, RefreshCw, Layers, GitBranch, Network, BarChart2, Info, Eye, Sliders, Code2, Zap, Plus, Trash2, MoveRight, HelpCircle } from 'lucide-react';
import * as d3 from 'd3';

interface CudaQuantumStudioProps {
  onApplySynthesizedCode: (code: string) => void;
}

interface CustomGateItem {
  id: string;
  type: 'gate_h' | 'gate_cnot' | 'gate_t' | 'gate_x' | 'gate_rx' | 'gate_mz';
  label: string;
  targetQubit: number;
  controlQubit?: number;
  details: string;
}

interface QuantumNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'qubit' | 'gate_h' | 'gate_cnot' | 'gate_t' | 'gate_x' | 'gate_rx' | 'gate_rz' | 'gate_mz' | 'tensor_node' | 'state_vector';
  amplitude?: number;
  phase?: number;
  qubitIndex?: number;
  details?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface QuantumLink extends d3.SimulationLinkDatum<QuantumNode> {
  source: string | QuantumNode;
  target: string | QuantumNode;
  strength?: number;
  label?: string;
}

const AVAILABLE_PALETTE_GATES = [
  {
    type: 'gate_h' as const,
    label: 'Hadamard (H)',
    symbol: 'H',
    color: 'bg-indigo-900 border-indigo-700 text-cyan-200',
    description: 'Puts qubit into superposition (|0⟩ + |1⟩)/√2'
  },
  {
    type: 'gate_cnot' as const,
    label: 'Controlled-NOT (CX)',
    symbol: 'CX',
    color: 'bg-teal-900 border-teal-700 text-teal-200',
    description: 'Two-qubit entanglement gate (Control → Target)'
  },
  {
    type: 'gate_t' as const,
    label: 'T-Gate (π/4 Phase)',
    symbol: 'T',
    color: 'bg-purple-900 border-purple-700 text-purple-200',
    description: 'Applies π/4 phase shift to |1⟩ state'
  },
  {
    type: 'gate_x' as const,
    label: 'Pauli-X (Bit-Flip)',
    symbol: 'X',
    color: 'bg-amber-900 border-amber-700 text-amber-200',
    description: 'Flips |0⟩ to |1⟩ and vice versa'
  },
  {
    type: 'gate_rx' as const,
    label: 'Rotation Rx(θ)',
    symbol: 'Rx',
    color: 'bg-rose-900 border-rose-700 text-rose-200',
    description: 'Parametric rotation around X-axis'
  },
  {
    type: 'gate_mz' as const,
    label: 'Measurement (MZ)',
    symbol: 'MZ',
    color: 'bg-slate-800 border-slate-700 text-slate-200',
    description: 'Collapses quantum state onto computational Z-basis'
  }
];

export const CudaQuantumStudio: React.FC<CudaQuantumStudioProps> = ({ onApplySynthesizedCode }) => {
  const [activeSubTab, setActiveSubTab] = useState<'visualization' | 'cuda_kernel'>('visualization');
  const [circuitPreset, setCircuitPreset] = useState<'bell' | 'ghz' | 'qft' | 'vqe' | 'custom'>('ghz');
  const [graphMode, setGraphMode] = useState<'circuit' | 'tensor' | 'state_vector'>('circuit');
  const [numQubits, setNumQubits] = useState<number>(4);
  const [selectedNode, setSelectedNode] = useState<QuantumNode | null>(null);
  const [isSimulatingEvolution, setIsSimulatingEvolution] = useState<boolean>(false);
  const [evolutionStep, setEvolutionStep] = useState<number>(0);

  // Custom added gates state
  const [customGates, setCustomGates] = useState<CustomGateItem[]>([]);
  const [targetAddQubit, setTargetAddQubit] = useState<number>(0);
  const [draggedGateType, setDraggedGateType] = useState<CustomGateItem['type'] | null>(null);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const showNotification = (msg: string) => {
    setLastActionMessage(msg);
    setTimeout(() => setLastActionMessage(null), 3000);
  };

  const addGateToCircuit = (gateType: CustomGateItem['type'], targetQb: number) => {
    const newGate: CustomGateItem = {
      id: `custom-gate-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: gateType,
      label: gateType === 'gate_h' ? 'Hadamard H'
        : gateType === 'gate_cnot' ? `CNOT (${targetQb}→${(targetQb + 1) % numQubits})`
        : gateType === 'gate_t' ? 'T-Gate'
        : gateType === 'gate_x' ? 'Pauli-X'
        : gateType === 'gate_rx' ? 'Rx(π/2)'
        : 'Measure Z',
      targetQubit: targetQb,
      controlQubit: gateType === 'gate_cnot' ? (targetQb > 0 ? targetQb - 1 : numQubits - 1) : undefined,
      details: `Användartillagd ${gateType.replace('gate_', '').toUpperCase()}-port på q[${targetQb}]`
    };

    setCustomGates(prev => [...prev, newGate]);
    if (circuitPreset !== 'custom') {
      setCircuitPreset('custom');
    }
    showNotification(`Lade till ${newGate.label} på qubit q[${targetQb}]`);
  };

  const removeCustomGate = (gateId: string) => {
    setCustomGates(prev => prev.filter(g => g.id !== gateId));
    showNotification('Tog bort valda porten från kretsen');
  };

  const clearAllCustomGates = () => {
    setCustomGates([]);
    showNotification('Rensade alla anpassade portar');
  };

  // Dynamically generate CUDA-Q kernel C++ code
  const generateDynamicCudaCode = () => {
    let codeStr = `// CUDA-Q Quantum Neural Circuit (Dynamiskt Genererad)\n#include <cudaq.h>\n\nstruct quantum_circuit {\n  void operator()(int numQubits) __qpu__ {\n    cudaq::qvector q(numQubits);\n`;

    if (circuitPreset === 'bell') {
      codeStr += `    h(q[0]);\n    x<cudaq::ctrl>(q[0], q[1]);\n    mz(q);\n`;
    } else if (circuitPreset === 'ghz') {
      codeStr += `    h(q[0]);\n`;
      for (let i = 0; i < numQubits - 1; i++) {
        codeStr += `    x<cudaq::ctrl>(q[${i}], q[${i + 1}]);\n`;
      }
      codeStr += `    mz(q);\n`;
    } else if (circuitPreset === 'custom' || customGates.length > 0) {
      if (customGates.length === 0) {
        codeStr += `    // Ingen anpassad port tillagd ännu.\n    h(q[0]);\n`;
      } else {
        customGates.forEach(g => {
          if (g.type === 'gate_h') codeStr += `    h(q[${g.targetQubit}]);\n`;
          else if (g.type === 'gate_cnot') codeStr += `    x<cudaq::ctrl>(q[${g.controlQubit ?? 0}], q[${g.targetQubit}]);\n`;
          else if (g.type === 'gate_t') codeStr += `    t(q[${g.targetQubit}]);\n`;
          else if (g.type === 'gate_x') codeStr += `    x(q[${g.targetQubit}]);\n`;
          else if (g.type === 'gate_rx') codeStr += `    rx(1.5708, q[${g.targetQubit}]);\n`;
          else if (g.type === 'gate_mz') codeStr += `    mz(q[${g.targetQubit}]);\n`;
        });
      }
    } else {
      codeStr += `    // QFT / VQE Standard Setup\n    for (int i = 0; i < numQubits; ++i) {\n      h(q[i]);\n    }\n    mz(q);\n`;
    }

    codeStr += `  }\n};\n\nint main() {\n  auto result = cudaq::sample(quantum_circuit{}, ${numQubits});\n  result.dump();\n  return 0;\n}`;
    return codeStr;
  };

  // Generate graph dataset based on preset, mode and custom gates
  const getGraphData = (): { nodes: QuantumNode[]; links: QuantumLink[] } => {
    const nodes: QuantumNode[] = [];
    const links: QuantumLink[] = [];

    if (graphMode === 'circuit') {
      // 1. Qubit Register Nodes
      for (let i = 0; i < numQubits; i++) {
        nodes.push({
          id: `q-${i}`,
          label: `q[${i}]`,
          type: 'qubit',
          qubitIndex: i,
          amplitude: 1.0,
          phase: 0.0,
          details: `Qubit register q[${i}] initialized to state |0⟩`
        });
      }

      if (circuitPreset === 'bell') {
        nodes.push({ id: 'g-h0', label: 'Hadamard H', type: 'gate_h', qubitIndex: 0, details: 'Puts q[0] into superposition (|0⟩ + |1⟩)/√2' });
        nodes.push({ id: 'g-cnot01', label: 'CNOT (0→1)', type: 'gate_cnot', qubitIndex: 1, details: 'Entangles q[0] control with q[1] target' });
        nodes.push({ id: 'g-mz0', label: 'Measure q[0]', type: 'gate_mz', qubitIndex: 0, details: 'Collapse quantum state on Z basis' });
        nodes.push({ id: 'g-mz1', label: 'Measure q[1]', type: 'gate_mz', qubitIndex: 1, details: 'Collapse quantum state on Z basis' });

        links.push({ source: 'q-0', target: 'g-h0', label: 'q[0] input' });
        links.push({ source: 'g-h0', target: 'g-cnot01', label: 'Control' });
        links.push({ source: 'q-1', target: 'g-cnot01', label: 'Target' });
        links.push({ source: 'g-cnot01', target: 'g-mz0', label: 'q[0] line' });
        links.push({ source: 'g-cnot01', target: 'g-mz1', label: 'q[1] line' });
      } else if (circuitPreset === 'ghz') {
        nodes.push({ id: 'g-h0', label: 'Hadamard H', type: 'gate_h', qubitIndex: 0, details: 'Puts q[0] into superposition' });

        for (let i = 0; i < numQubits - 1; i++) {
          nodes.push({
            id: `g-cnot-${i}-${i+1}`,
            label: `CNOT (${i}→${i+1})`,
            type: 'gate_cnot',
            qubitIndex: i + 1,
            details: `Controlled-NOT entangling q[${i}] to q[${i+1}]`
          });
        }

        for (let i = 0; i < numQubits; i++) {
          nodes.push({
            id: `g-mz-${i}`,
            label: `MZ q[${i}]`,
            type: 'gate_mz',
            qubitIndex: i,
            details: `Measurement operator for qubit q[${i}]`
          });
        }

        links.push({ source: 'q-0', target: 'g-h0' });
        links.push({ source: 'g-h0', target: 'g-cnot-0-1' });
        links.push({ source: 'q-1', target: 'g-cnot-0-1' });

        for (let i = 1; i < numQubits - 1; i++) {
          links.push({ source: `g-cnot-${i-1}-${i}`, target: `g-cnot-${i}-${i+1}` });
          links.push({ source: `q-${i+1}`, target: `g-cnot-${i}-${i+1}` });
        }

        for (let i = 0; i < numQubits; i++) {
          const lastGate = i === 0 ? 'g-h0' : `g-cnot-${i-1}-${i}`;
          links.push({ source: lastGate, target: `g-mz-${i}` });
        }
      } else if (circuitPreset === 'custom') {
        // Build nodes from customGates array
        if (customGates.length === 0) {
          // Placeholder node if empty
          nodes.push({
            id: 'g-empty-hint',
            label: 'Dra port hit',
            type: 'gate_h',
            qubitIndex: 0,
            details: 'Släpp kvantportar från sidopanelen hit för att bygga kretsen'
          });
          links.push({ source: 'q-0', target: 'g-empty-hint' });
        } else {
          const qubitLastGateMap: Record<number, string> = {};

          customGates.forEach((cg) => {
            nodes.push({
              id: cg.id,
              label: cg.label,
              type: cg.type,
              qubitIndex: cg.targetQubit,
              details: cg.details
            });

            const prevNode = qubitLastGateMap[cg.targetQubit] || `q-${cg.targetQubit}`;
            links.push({ source: prevNode, target: cg.id });
            qubitLastGateMap[cg.targetQubit] = cg.id;

            if (cg.controlQubit !== undefined) {
              const prevControl = qubitLastGateMap[cg.controlQubit] || `q-${cg.controlQubit}`;
              links.push({ source: prevControl, target: cg.id, label: 'Control' });
              qubitLastGateMap[cg.controlQubit] = cg.id;
            }
          });
        }
      } else if (circuitPreset === 'qft') {
        for (let i = 0; i < numQubits; i++) {
          nodes.push({ id: `g-h-${i}`, label: `H q[${i}]`, type: 'gate_h', qubitIndex: i, details: 'QFT Hadamard Transformation' });
          links.push({ source: `q-${i}`, target: `g-h-${i}` });
        }
        for (let i = 0; i < numQubits - 1; i++) {
          nodes.push({ id: `g-rz-${i}`, label: `CRz(π/${i+2})`, type: 'gate_rz', qubitIndex: i, details: 'Controlled Phase Rotation' });
          links.push({ source: `g-h-${i}`, target: `g-rz-${i}` });
          links.push({ source: `g-h-${i+1}`, target: `g-rz-${i}` });
        }
      } else {
        // VQE
        for (let i = 0; i < numQubits; i++) {
          nodes.push({ id: `g-ry-${i}`, label: `Ry(θ_${i})`, type: 'gate_rz', qubitIndex: i, details: 'Variational Ansatz Rotation' });
          links.push({ source: `q-${i}`, target: `g-ry-${i}` });
        }
        for (let i = 0; i < numQubits - 1; i++) {
          nodes.push({ id: `g-vqe-cnot-${i}`, label: `CNOT (${i}→${i+1})`, type: 'gate_cnot', qubitIndex: i+1, details: 'Molecular orbital entanglement' });
          links.push({ source: `g-ry-${i}`, target: `g-vqe-cnot-${i}` });
        }
      }
    } else if (graphMode === 'tensor') {
      // Tensor Network Contraction Nodes
      for (let i = 0; i < numQubits; i++) {
        nodes.push({
          id: `t-qubit-${i}`,
          label: `Tensor T_q${i}`,
          type: 'tensor_node',
          qubitIndex: i,
          details: `Physical Qubit State Tensor (Bond dim = 2, Shape = [2, 16])`
        });
      }

      nodes.push({ id: 't-h-op', label: 'Tensor T_Hadamard', type: 'tensor_node', details: 'Operator Tensor 2x2 Matrix' });
      nodes.push({ id: 't-cnot-op', label: 'Tensor T_CNOT', type: 'tensor_node', details: 'Rank-4 Control-Target Entanglement Tensor' });
      nodes.push({ id: 't-hamiltonian', label: 'Hamiltonian H_mol', type: 'tensor_node', details: 'Molecular Hamiltonian Energy Tensor' });

      links.push({ source: 't-qubit-0', target: 't-h-op', label: 'Bond 0' });
      links.push({ source: 't-h-op', target: 't-cnot-op', label: 'Bond 1' });

      for (let i = 1; i < numQubits; i++) {
        links.push({ source: `t-qubit-${i}`, target: 't-cnot-op', label: `Bond q${i}` });
      }
      links.push({ source: 't-cnot-op', target: 't-hamiltonian', label: 'Energy Expectation' });
    } else {
      // State Vector Basis
      const numStates = Math.min(16, Math.pow(2, numQubits));
      for (let i = 0; i < numStates; i++) {
        const bin = i.toString(2).padStart(numQubits, '0');
        const isSuperpositionState = circuitPreset === 'bell' || circuitPreset === 'ghz' 
          ? (i === 0 || i === numStates - 1) 
          : true;
        const amp = isSuperpositionState ? 1 / Math.sqrt(2) : 0;
        const prob = Math.pow(amp, 2);

        nodes.push({
          id: `st-${bin}`,
          label: `|${bin}⟩`,
          type: 'state_vector',
          amplitude: amp,
          phase: (i * 45 + evolutionStep * 15) % 360,
          details: `Basis State |${bin}⟩ — Amplitude: ${amp.toFixed(3)}, Probability: ${(prob * 100).toFixed(1)}%`
        });
      }

      for (let i = 0; i < nodes.length - 1; i++) {
        links.push({ source: nodes[i].id, target: nodes[i + 1].id });
      }
    }

    return { nodes, links };
  };

  // Render D3 Simulation
  useEffect(() => {
    if (activeSubTab !== 'visualization' || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 440;

    const { nodes, links } = getGraphData();

    // D3 Force Simulation setup
    const simulation = d3.forceSimulation<QuantumNode>(nodes)
      .force('link', d3.forceLink<QuantumNode, QuantumLink>(links).id(d => d.id).distance(110))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.1))
      .force('y', d3.forceY(height / 2).strength(0.1));

    // SVG Container Layer Group
    const container = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.5])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Render Links
    const linkGroup = container.append('g').selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#334155')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', (d) => (d.label === 'Control' ? '4,4' : 'none'));

    // Render Nodes Group
    const nodeGroup = container.append('g').selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, QuantumNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      )
      .on('click', (event, d) => {
        setSelectedNode(d);
      });

    // Draw Node Circles / Rectangles based on Type
    nodeGroup.each(function(d) {
      const g = d3.select(this);

      if (d.type === 'qubit') {
        g.append('circle')
          .attr('r', 22)
          .attr('fill', '#0284c7')
          .attr('stroke', '#38bdf8')
          .attr('stroke-width', 2.5);
      } else if (d.type === 'gate_h') {
        g.append('rect')
          .attr('x', -20)
          .attr('y', -20)
          .attr('width', 40)
          .attr('height', 40)
          .attr('rx', 6)
          .attr('fill', '#4f46e5')
          .attr('stroke', '#818cf8')
          .attr('stroke-width', 2);
      } else if (d.type === 'gate_cnot') {
        g.append('circle')
          .attr('r', 20)
          .attr('fill', '#0d9488')
          .attr('stroke', '#2dd4bf')
          .attr('stroke-width', 2);
      } else if (d.type === 'gate_t') {
        g.append('rect')
          .attr('x', -19)
          .attr('y', -19)
          .attr('width', 38)
          .attr('height', 38)
          .attr('rx', 8)
          .attr('fill', '#7e22ce')
          .attr('stroke', '#c084fc')
          .attr('stroke-width', 2);
      } else if (d.type === 'gate_x') {
        g.append('rect')
          .attr('x', -19)
          .attr('y', -19)
          .attr('width', 38)
          .attr('height', 38)
          .attr('rx', 5)
          .attr('fill', '#d97706')
          .attr('stroke', '#fcd34d')
          .attr('stroke-width', 2);
      } else if (d.type === 'gate_rx') {
        g.append('circle')
          .attr('r', 19)
          .attr('fill', '#e11d48')
          .attr('stroke', '#fda4af')
          .attr('stroke-width', 2);
      } else if (d.type === 'gate_mz') {
        g.append('rect')
          .attr('x', -18)
          .attr('y', -18)
          .attr('width', 36)
          .attr('height', 36)
          .attr('rx', 4)
          .attr('fill', '#334155')
          .attr('stroke', '#64748b')
          .attr('stroke-width', 2);
      } else if (d.type === 'tensor_node') {
        g.append('polygon')
          .attr('points', '-22,0 0,-22 22,0 0,22')
          .attr('fill', '#7c3aed')
          .attr('stroke', '#a78bfa')
          .attr('stroke-width', 2);
      } else {
        // State Vector
        g.append('circle')
          .attr('r', 18)
          .attr('fill', (d.amplitude && d.amplitude > 0) ? '#059669' : '#1e293b')
          .attr('stroke', (d.amplitude && d.amplitude > 0) ? '#34d399' : '#475569')
          .attr('stroke-width', 2);
      }

      // Add Text Label
      g.append('text')
        .text(d.label)
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .attr('fill', '#f8fafc')
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'monospace');
    });

    // Tick Handler for updating positions
    simulation.on('tick', () => {
      linkGroup
        .attr('x1', d => (d.source as QuantumNode).x || 0)
        .attr('y1', d => (d.source as QuantumNode).y || 0)
        .attr('x2', d => (d.target as QuantumNode).x || 0)
        .attr('y2', d => (d.target as QuantumNode).y || 0);

      nodeGroup
        .attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [activeSubTab, circuitPreset, graphMode, numQubits, evolutionStep, customGates]);

  // Pulse animation timer
  useEffect(() => {
    let interval: any = null;
    if (isSimulatingEvolution) {
      interval = setInterval(() => {
        setEvolutionStep(prev => prev + 1);
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulatingEvolution]);

  const handleDragOverCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedGateType) {
      addGateToCircuit(draggedGateType, targetAddQubit);
      setDraggedGateType(null);
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4 font-mono text-xs">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-cyan-950 border border-indigo-800 flex items-center justify-center font-bold text-indigo-300">
            <Atom className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 font-sans">
                NVIDIA CUDA-Q Quantum Studio
              </h2>
              <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-300 border border-slate-700 rounded font-semibold">
                D3.js Quantum State Visualizer
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              On-device simuleringsmotor för kvantkretsar, kvanttillstånd och tensornätverk.
            </p>
          </div>
        </div>

        {/* Sub-Tab Navigation */}
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded border border-slate-800">
          <button
            onClick={() => setActiveSubTab('visualization')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'visualization'
                ? 'bg-slate-800 text-slate-100 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-slate-400" />
            <span>Kvanttillstånd D3 Visualisering</span>
          </button>

          <button
            onClick={() => setActiveSubTab('cuda_kernel')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'cuda_kernel'
                ? 'bg-slate-800 text-slate-100 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5 text-slate-400" />
            <span>CUDA-Q Kod & Kompilering</span>
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {lastActionMessage && (
        <div className="bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2 rounded text-xs flex items-center justify-between shadow-lg animate-fade-in">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>{lastActionMessage}</span>
          </span>
        </div>
      )}

      {/* Tab 1: Quantum State Visualization (D3.js Graph with Drag-and-Drop Palette) */}
      {activeSubTab === 'visualization' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Preset Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-bold text-[11px]">Krets-preset:</span>
                <select
                  value={circuitPreset}
                  onChange={(e) => setCircuitPreset(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-slate-600"
                >
                  <option value="bell">Bell State (|Φ+⟩)</option>
                  <option value="ghz">GHZ Entanglement (|GHZ⟩)</option>
                  <option value="custom">Anpassad Drag-&-Drop Krets</option>
                  <option value="qft">Quantum Fourier Transform (QFT)</option>
                  <option value="vqe">Variational Molecule (VQE)</option>
                </select>
              </div>

              {/* View Mode Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-bold text-[11px]">Graf-läge:</span>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-slate-800">
                  <button
                    onClick={() => setGraphMode('circuit')}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      graphMode === 'circuit' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    Krets
                  </button>
                  <button
                    onClick={() => setGraphMode('tensor')}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      graphMode === 'tensor' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    Tensornätverk
                  </button>
                  <button
                    onClick={() => setGraphMode('state_vector')}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      graphMode === 'state_vector' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    Tillståndsvektor
                  </button>
                </div>
              </div>

              {/* Qubit Count Slider */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-bold text-[11px]">Qubits:</span>
                <input
                  type="range"
                  min="2"
                  max="6"
                  value={numQubits}
                  onChange={(e) => setNumQubits(parseInt(e.target.value, 10))}
                  className="w-20 accent-slate-400"
                />
                <span className="text-slate-200 font-bold">{numQubits}</span>
              </div>
            </div>

            {/* Simulation Evolution Toggle & Clear Custom */}
            <div className="flex items-center gap-2">
              {circuitPreset === 'custom' && customGates.length > 0 && (
                <button
                  onClick={clearAllCustomGates}
                  className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-rose-400 rounded text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Rensa Portar</span>
                </button>
              )}

              <button
                onClick={() => setIsSimulatingEvolution(!isSimulatingEvolution)}
                className={`px-3 py-1.5 rounded font-bold text-xs border transition-colors flex items-center gap-1.5 ${
                  isSimulatingEvolution
                    ? 'bg-slate-800 text-slate-100 border-slate-600'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-900'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSimulatingEvolution ? 'animate-spin text-slate-300' : 'text-slate-400'}`} />
                <span>{isSimulatingEvolution ? 'Pausa Evolution' : 'Puls-simulera Fas'}</span>
              </button>
            </div>
          </div>

          {/* Interactive Drag-and-Drop Layout Grid: Palette + D3 Canvas + Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Interactive Quantum Gate Palette Sidebar */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-3 lg:col-span-1">
              <div className="pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-slate-400" />
                  Kvantport-Palett
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Dra portar till duken eller välj qubit nedan för snabb-tillägg.
                </p>
              </div>

              {/* Target Qubit Selector for Quick Add */}
              <div className="flex items-center justify-between bg-slate-950 p-2 rounded border border-slate-800">
                <span className="text-[11px] text-slate-400 font-bold">Mål Qubit:</span>
                <select
                  value={targetAddQubit}
                  onChange={(e) => setTargetAddQubit(parseInt(e.target.value, 10))}
                  className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2 py-0.5 rounded"
                >
                  {Array.from({ length: numQubits }).map((_, idx) => (
                    <option key={idx} value={idx}>q[{idx}]</option>
                  ))}
                </select>
              </div>

              {/* Draggable Gate List */}
              <div className="space-y-2">
                {AVAILABLE_PALETTE_GATES.map((gate) => (
                  <div
                    key={gate.type}
                    draggable
                    onDragStart={() => setDraggedGateType(gate.type)}
                    className={`p-2.5 rounded border ${gate.color} cursor-grab active:cursor-grabbing hover:brightness-110 transition-all flex items-center justify-between group`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <span className="w-5 h-5 rounded bg-black/30 border border-white/10 flex items-center justify-center text-[10px] font-mono">
                          {gate.symbol}
                        </span>
                        <span>{gate.label}</span>
                      </div>
                      <p className="text-[10px] text-slate-300 opacity-80 leading-tight">
                        {gate.description}
                      </p>
                    </div>

                    <button
                      onClick={() => addGateToCircuit(gate.type, targetAddQubit)}
                      title={`Lägg till på q[${targetAddQubit}]`}
                      className="p-1 bg-black/40 hover:bg-black/60 rounded border border-white/20 text-slate-200 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Added Custom Gates Stack */}
              {circuitPreset === 'custom' && customGates.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Tillagda Portar ({customGates.length})
                  </span>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {customGates.map((cg) => (
                      <div key={cg.id} className="p-1.5 bg-slate-950 border border-slate-800 rounded flex items-center justify-between text-[11px]">
                        <span className="text-slate-200 font-mono">
                          {cg.label} → q[{cg.targetQubit}]
                        </span>
                        <button
                          onClick={() => removeCustomGate(cg.id)}
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Main D3 Interactive Canvas with Drop Zone */}
            <div
              onDragOver={handleDragOverCanvas}
              onDrop={handleDropOnCanvas}
              className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-lg p-2 relative overflow-hidden flex flex-col items-center justify-center min-h-[460px]"
            >
              <div className="absolute top-3 left-3 text-[10px] text-slate-500 font-mono z-10 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
                <span>D3.js Force Layout • Släpp kvantportar här eller dra noder för att strukturera</span>
              </div>

              <svg
                ref={svgRef}
                viewBox="0 0 800 440"
                className="w-full h-[440px] bg-slate-950 rounded cursor-grab active:cursor-grabbing"
              />
            </div>

            {/* Selected Node Details & Quantum State Metrics Sidebar */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4 lg:col-span-1">
              <div className="pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-slate-400" />
                  Nodegenskaper & Kvantmetrik
                </h3>
              </div>

              {selectedNode ? (
                <div className="space-y-3 bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-bold">Nod ID:</span>
                    <span className="text-slate-200 font-mono font-bold">{selectedNode.id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-bold">Typ:</span>
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] uppercase font-bold">
                      {selectedNode.type}
                    </span>
                  </div>
                  {selectedNode.details && (
                    <div className="space-y-1 pt-2 border-t border-slate-800 text-[11px] text-slate-300 leading-relaxed">
                      <span className="text-slate-400 block font-bold">Beskrivning:</span>
                      <p>{selectedNode.details}</p>
                    </div>
                  )}
                  {selectedNode.amplitude !== undefined && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">Sannolikhet:</span>
                        <span className="text-slate-200 font-bold">
                          {(Math.pow(selectedNode.amplitude, 2) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-slate-300 h-full transition-all duration-300"
                          style={{ width: `${Math.pow(selectedNode.amplitude, 2) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-slate-950 rounded border border-slate-800 text-slate-500 text-center text-xs">
                  Klicka på en nod i D3-grafen för att granska kvantfaser, operátormatriser och sannolikheter.
                </div>
              )}

              {/* State Vector Amplitudes Breakdown */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Simulerad Tillståndssannolikhet
                </span>
                <div className="space-y-1.5 bg-slate-950 p-2.5 rounded border border-slate-800">
                  {circuitPreset === 'bell' || circuitPreset === 'ghz' ? (
                    <>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300">|{ '0'.repeat(numQubits) }⟩</span>
                        <span className="text-slate-200 font-bold">50.0%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-slate-300 h-full w-1/2" />
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span className="text-slate-300">|{ '1'.repeat(numQubits) }⟩</span>
                        <span className="text-slate-200 font-bold">50.0%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-slate-300 h-full w-1/2" />
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] text-slate-400">
                      Jämn kvantsuperposition över {Math.pow(2, numQubits)} bas-tillstånd.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: CUDA-Q Kernel Code & Compiler */}
      {activeSubTab === 'cuda_kernel' && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100">CUDA-Q Kernel Källkod</h3>
              <p className="text-xs text-slate-400">Skriv och simulera kvantkretsar i C++20 / Python med CUDA-Q acceleration.</p>
            </div>

            <button
              onClick={() => onApplySynthesizedCode(generateDynamicCudaCode())}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold border border-slate-700 rounded transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-slate-400" />
              <span>Öppna i IDE</span>
            </button>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-slate-200 leading-relaxed overflow-x-auto">
            <pre>{generateDynamicCudaCode()}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
