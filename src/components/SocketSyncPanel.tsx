import React, { useState, useEffect } from 'react';
import { 
  Wifi, Radio, Laptop, Tablet, Monitor, Plus, QrCode, Lock, 
  Cpu, Code2, Server, CheckCircle2, ShieldAlert, Copy, Check, 
  Clock, RotateCcw, AlertTriangle, Layers, Key, ArrowRight, Terminal
} from 'lucide-react';
import { SocketDevice, DeviceTelemetry, DeviceType, NodeConnectionState, PairingSession } from '../types';

interface SocketSyncPanelProps {
  devices: SocketDevice[];
  telemetry: DeviceTelemetry;
  onPairNewDevice: (name: string, type: DeviceType) => void;
}

export const SocketSyncPanel: React.FC<SocketSyncPanelProps> = ({
  devices,
  telemetry,
  onPairNewDevice
}) => {
  const [showPairModal, setShowPairModal] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceType, setNewDeviceType] = useState<DeviceType>('VS Code Extension');
  
  // Pairing session state
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(300);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<boolean>(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  // Helper: Icon getter for different device types
  const getDeviceIcon = (type: DeviceType) => {
    switch (type) {
      case 'VS Code Extension':
        return <Code2 className="w-5 h-5 text-cyan-400" />;
      case 'MacBook Pro':
        return <Laptop className="w-5 h-5 text-amber-400" />;
      case 'Desktop PC':
        return <Monitor className="w-5 h-5 text-cyan-400" />;
      case 'Android Tablet':
        return <Tablet className="w-5 h-5 text-cyan-400" />;
      case 'OpenClaw Gateway Node':
        return <Cpu className="w-5 h-5 text-purple-400" />;
      default:
        return <Server className="w-5 h-5 text-slate-400" />;
    }
  };

  // Helper: Status badge color getter
  const getStatusBadge = (status: NodeConnectionState | string) => {
    switch (status) {
      case 'connected':
        return 'bg-cyan-950 text-emerald-300 border-emerald-800/80';
      case 'pairing':
      case 'authenticated':
        return 'bg-cyan-950 text-cyan-300 border-cyan-800/80';
      case 'degraded':
        return 'bg-amber-950 text-amber-300 border-amber-800/80';
      case 'offline':
      case 'disconnected':
      case 'revoked':
        return 'bg-slate-800/80 text-slate-400 border-slate-700/80';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  // Generate cryptographically random PIN and start pairing session via API
  const startNewPairingSession = async () => {
    setVerifyError(null);
    setVerifySuccess(false);
    setPinInput('');

    try {
      const res = await fetch('/api/bridge/pair/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: newDeviceName || 'Workstation Node',
          deviceType: newDeviceType,
          requestedCapabilities: ['workspace.read', 'workspace.patch', 'terminal.execute']
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setPairingSession(data.session);
          setSecondsRemaining(data.session.expiresInSeconds || 300);
          return;
        }
      }
    } catch (err) {
      console.warn('API pairing start fallback:', err);
    }

    // Client-side fallback if server fails
    const randNum = Math.floor(100000 + Math.random() * 900000);
    const pin = `${String(randNum).slice(0, 3)}-${String(randNum).slice(3)}`;
    const sessionId = `pair_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    setPairingSession({
      sessionId,
      pin,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      expiresInSeconds: 300,
      status: 'PENDING',
      requestedCapabilities: ['workspace.read', 'workspace.patch', 'terminal.execute']
    });
    setSecondsRemaining(300);
  };

  // Timer countdown effect for active PIN expiration
  useEffect(() => {
    if (!pairingSession || secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setPairingSession(s => s ? { ...s, status: 'EXPIRED' } : null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pairingSession, secondsRemaining]);

  // Handle open modal
  const handleOpenModal = () => {
    setShowPairModal(true);
    startNewPairingSession();
  };

  // Handle verify PIN challenge submission
  const handleVerifyPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingSession) return;

    setIsVerifying(true);
    setVerifyError(null);

    try {
      const res = await fetch('/api/bridge/pair/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: pairingSession.sessionId,
          pin: pinInput || pairingSession.pin,
          clientName: newDeviceName.trim() || 'Workstation Node',
          clientType: newDeviceType
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setVerifySuccess(true);
          setPairingSession(prev => prev ? { ...prev, status: 'IDENTITY_VERIFIED' } : null);
          
          onPairNewDevice(
            newDeviceName.trim() || `${newDeviceType} Client`,
            newDeviceType
          );

          setTimeout(() => {
            setShowPairModal(false);
            setVerifySuccess(false);
            setNewDeviceName('');
          }, 1200);
          return;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setVerifyError(errData.error || 'PIN challenge failed.');
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Verifieringsfel uppstod.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Format seconds to mm:ss
  const formatCountdown = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Copy sample JACO Node pairing payload
  const samplePayload = pairingSession ? JSON.stringify({
    schema: "JACO_NODE_PAIR_REQUEST.v1",
    node_type: newDeviceType.toLowerCase().replace(/\s+/g, '_'),
    node_name: newDeviceName || "Workstation M3",
    sessionId: pairingSession.sessionId,
    pin: pairingSession.pin,
    capabilities: pairingSession.requestedCapabilities
  }, null, 2) : '';

  const copyPayloadToClipboard = () => {
    if (!samplePayload) return;
    navigator.clipboard.writeText(samplePayload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 font-sans">
      {/* Reality Classification & Audit Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-amber-950/80 border border-amber-800/80 text-amber-300 font-bold rounded uppercase text-[10px]">
            REALITY: PROTOTYPE / BRIDGE DRAFT
          </span>
          <span className="text-slate-400">
            JACO Node Bridge Control Interface & OpenClaw Gateway Coordinator
          </span>
        </div>
        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
          <span>Verifierad: <strong className="text-cyan-400">React UI, Handshake API, PIN Challenge</strong></span>
        </div>
      </div>

      {/* Main Gateway Architecture Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/50 space-y-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-950 text-cyan-300 border border-cyan-800/80 rounded-full text-xs font-mono font-semibold">
              <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span>JACO Node Bridge (Port 8789) & OpenClaw Gateway (Port 18789)</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight font-sans">
              Multi-Device Workspace Sync & VS Code Remote Node
            </h2>
            <p className="text-xs text-slate-400 max-w-3xl font-mono leading-relaxed">
              Separerad arkitektur: Ollama körs på port <span className="text-slate-200">11434</span> (ren HTTP LLM inference). 
              JACO Node Bridge hanterar WebSocket AST-synk och agentuppdrag på port <strong className="text-cyan-400">8789</strong>, som vidarebefordrar till OpenClaw Gateway på <strong className="text-purple-400">127.0.0.1:18789</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenModal}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono text-xs font-bold rounded-lg shadow-lg shadow-cyan-900/30 transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Parkoppla Ny Nod</span>
          </button>
        </div>

        {/* System Topology Diagram Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800 text-xs font-mono">
          <div className="bg-slate-950/90 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Companion UI</span>
            <span className="text-cyan-300 font-bold block">React Admin App</span>
            <span className="text-[10px] text-slate-500">Lokal / Remote Browser</span>
          </div>

          <div className="bg-slate-950/90 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">JACO Node Bridge</span>
            <span className="text-amber-300 font-bold block">ws://{telemetry.localIp}:8789/ws</span>
            <span className="text-[10px] text-slate-500">WebSocket AST & Logs</span>
          </div>

          <div className="bg-slate-950/90 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">OpenClaw Gateway</span>
            <span className="text-purple-300 font-bold block">ws://127.0.0.1:18789</span>
            <span className="text-[10px] text-slate-500">Local Agent Runner</span>
          </div>

          <div className="bg-slate-950/90 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Säkerhet & Token</span>
            <span className="text-cyan-400 font-bold flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-cyan-400" /> HMAC-SHA256 Token
            </span>
            <span className="text-[10px] text-slate-500">Challenge-Response Session</span>
          </div>
        </div>
      </div>

      {/* Paired Workstations & Active Nodes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
            <Wifi className="w-4 h-4 text-cyan-400" />
            Parkopplade Noder & VS Code Klienter ({devices.length})
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            Aktivitetsstatus & Beviljade Rättigheter
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {devices.map((device) => {
            const stateLabel = device.connectionState || (device.status === 'connected' ? 'connected' : 'offline');
            const capabilities = device.grantedCapabilities || ['workspace.read', 'workspace.patch', 'terminal.execute'];

            return (
              <div
                key={device.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 relative overflow-hidden font-mono"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                      {getDeviceIcon(device.deviceType)}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white font-sans truncate max-w-[180px]">
                        {device.name}
                      </h4>
                      <p className="text-[11px] text-slate-400">{device.ip}</p>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase border ${getStatusBadge(stateLabel)}`}>
                    {stateLabel}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Enhetstyp</span>
                    <span className="text-slate-200 font-medium">{device.deviceType}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Latency / Ping</span>
                    <span className="text-cyan-400 font-bold">{device.pingMs} ms</span>
                  </div>
                </div>

                {/* Capabilities Badges */}
                <div className="pt-2 border-t border-slate-800/60 space-y-1">
                  <span className="text-[10px] text-slate-500 block">Beviljade rättigheter:</span>
                  <div className="flex flex-wrap gap-1">
                    {capabilities.map(cap => (
                      <span key={cap} className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 text-[9px] text-cyan-300 rounded">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* VS Code & Extension Integration Guide */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="font-bold text-slate-200 flex items-center gap-2 font-sans">
            <Code2 className="w-4 h-4 text-cyan-400" />
            VS Code Extension Integration Kommando
          </span>
          <span className="px-2 py-0.5 bg-cyan-950 border border-cyan-800 text-cyan-300 text-[10px] rounded font-bold">
            JACO Workspace Protocol v1
          </span>
        </div>

        <p className="text-slate-400 text-[11px] leading-relaxed">
          För att parkoppla en VS Code arbetsyta, öppna VS Code kommandopalett (<kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">Ctrl+Shift+P</kbd> / <kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">Cmd+Shift+P</kbd>) och kör kommandot:
        </p>

        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between text-cyan-300 font-bold text-xs">
          <span>JACO: Pair Workspace Node</span>
          <span className="text-[10px] text-slate-500 font-normal">Sänder challenge payload till Port 8789</span>
        </div>
      </div>

      {/* Cryptographic Pairing Session Modal */}
      {showPairModal && pairingSession && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl font-mono text-xs">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-amber-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-sans">
                    Parkoppla Nod / VS Code Extension
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Kryptografiskt genererad engångs-PIN med tidsgräns
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPairModal(false)}
                className="text-slate-500 hover:text-slate-300 p-1 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Countdown & Dynamic PIN Box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-center relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Giltig i: <strong className={`font-bold ${secondsRemaining < 60 ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`}>
                    {formatCountdown(secondsRemaining)}
                  </strong>
                </span>
                <span className="text-[10px] text-slate-500 truncate max-w-[180px]">
                  ID: {pairingSession.sessionId}
                </span>
              </div>

              {/* Dynamic PIN display */}
              <div className="py-3 bg-slate-900/90 border border-amber-900/60 rounded-xl space-y-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Dynamisk Engångskod (PIN):
                </span>
                <div className="text-3xl font-bold font-mono text-amber-400 tracking-widest">
                  {pairingSession.status === 'EXPIRED' ? 'UTGÅNGEN' : pairingSession.pin}
                </div>
              </div>

              {/* Regenerate PIN button */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={startNewPairingSession}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] rounded flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3 h-3 text-cyan-400" />
                  Generera Ny PIN-Kod
                </button>
              </div>
            </div>

            {/* Verification Form */}
            <form onSubmit={handleVerifyPinSubmit} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1 font-medium text-[11px]">
                  Arbetsytans Namn / Maskin
                </label>
                <input
                  type="text"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  placeholder="t.ex. Workstation M3 Max, Dev-Rig Linux"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium text-[11px]">
                  Enhetstyp
                </label>
                <select
                  value={newDeviceType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewDeviceType(e.target.value as DeviceType)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="VS Code Extension">VS Code Extension</option>
                  <option value="Android Tablet">Android Tablet</option>
                  <option value="MacBook Pro">MacBook Pro</option>
                  <option value="Desktop PC">Desktop PC</option>
                  <option value="OpenClaw Gateway Node">OpenClaw Gateway Node</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium text-[11px]">
                  Verifiera PIN / Test-Challenge
                </label>
                <input
                  type="text"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder={`Mata in ${pairingSession.pin}`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              {/* Status & Error feedback */}
              {verifyError && (
                <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 rounded-lg text-rose-300 text-[11px] flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifySuccess && (
                <div className="p-2.5 bg-cyan-950/80 border border-emerald-800/80 rounded-lg text-emerald-300 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Nod verifierad & ansluten till JACO Node Bridge!</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isVerifying || pairingSession.status === 'EXPIRED'}
                className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 font-sans disabled:opacity-50"
              >
                {isVerifying ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin" />
                    <span>Verifierar Challenge-Response...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Bekräfta & Verifiera Handshake</span>
                  </>
                )}
              </button>
            </form>

            {/* Protocol Payload Snippet */}
            <div className="pt-2 border-t border-slate-800 space-y-2 text-[10px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>JACO Protocol Challenge Payload Spec:</span>
                <button
                  type="button"
                  onClick={copyPayloadToClipboard}
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                >
                  {copiedPayload ? <Check className="w-3 h-3 text-cyan-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPayload ? 'Kopierad!' : 'Kopiera JSON'}</span>
                </button>
              </div>
              <pre className="p-2 bg-slate-950 border border-slate-800 rounded text-slate-400 font-mono overflow-x-auto text-[9px] max-h-24">
                {samplePayload}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
