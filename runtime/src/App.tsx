import React from 'react';
import { JacoAuraComputeIDE } from './components/JacoAuraComputeIDE';

// The Aura IDE is the product's only surface (operator decision 2026-10-02). The 29 legacy tabs that
// used to sit behind it were removed: several showed invented data (fabricated capability logs, RAM and
// NPU figures, canned agent plans). Backend features come back into the IDE one at a time, and only
// with observed data.
export default function App() {
  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent text-slate-100 font-sans flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      <main className="flex-1 min-h-0">
        <JacoAuraComputeIDE />
      </main>
    </div>
  );
}
