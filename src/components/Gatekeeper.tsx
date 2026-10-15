import React, { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, Zap, ShieldCheck } from 'lucide-react';

interface GatekeeperProps {
  children: (props: { requestExecution: (action: () => void, description?: string) => void }) => React.ReactNode;
}

export const Gatekeeper: React.FC<GatekeeperProps> = ({ children }) => {
  // Default to Full Agentic Intuition Autonomy (zero micro-approvals for technical sub-steps)
  const [autoApprove, setAutoApprove] = useState<boolean>(() => {
    const saved = localStorage.getItem('jaco_auto_approve');
    return saved !== null ? saved === 'true' : true;
  });

  const [showPrompt, setShowPrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ action: () => void, description: string } | null>(null);

  useEffect(() => {
    localStorage.setItem('jaco_auto_approve', String(autoApprove));
  }, [autoApprove]);

  const requestExecution = (
    action: () => void,
    description: string = "Ett arbetsflöde har begärt att modifiera filer eller exekvera terminalkommandon. Godkänner du denna handling?"
  ) => {
    // If autoApprove / agentic intuition mode is active, execute instantly without micro-approvals
    if (autoApprove) {
      action();
      return;
    }

    setPendingAction({ action, description });
    setShowPrompt(true);
  };

  const handleConfirm = () => {
    if (pendingAction) {
      pendingAction.action();
    }
    setShowPrompt(false);
    setPendingAction(null);
  };

  const handleCancel = () => {
    setShowPrompt(false);
    setPendingAction(null);
  };

  return (
    <>
      {children({ requestExecution })}

      {showPrompt && pendingAction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm font-sans">
          <div className="bg-slate-900 border border-amber-500/50 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/10 rounded-full shrink-0">
                <ShieldAlert className="w-6 h-6 text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-100 mb-2">Säkerhetsbekräftelse</h3>
                <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                  {pendingAction.description}
                </p>

                <div className="mb-5 p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoApproveToggle"
                    checked={autoApprove}
                    onChange={(e) => setAutoApprove(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                  />
                  <label htmlFor="autoApproveToggle" className="text-xs text-slate-300 font-medium cursor-pointer">
                    Tillåt alla tekniska delsteg automatiskt (Aktivera agentisk intuition utan mikrogodkännanden)
                  </label>
                </div>

                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" /> Neka
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/20 font-bold"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Godkänn
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

