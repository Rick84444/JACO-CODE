import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

type WindowsUpdate = {
  success: boolean;
  status: string;
  currentVersion: string;
  latestVersion?: string;
  installed?: boolean;
  releaseUrl?: string;
  installer?: { name: string; url: string; size: number; sha256: string | null };
};

// A published GitHub release is not a Git main commit. Never execute an installer
// automatically; the user initiates the download and approves Windows UAC.
export function JacoWindowsUpdates() {
  const { tr } = useOptionalUiLanguage();
  const [update, setUpdate] = useState<WindowsUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/product/windows-update', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (data && typeof data.status === 'string') setUpdate(data);
      else setUpdate(current => current ? { ...current, status: 'unreachable' } : { success: false, status: 'unreachable', currentVersion: '?' });
    } catch { setUpdate(current => current ? { ...current, status: 'unreachable' } : { success: false, status: 'unreachable', currentVersion: '?' }); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  if (!update || update.status === 'unsupported') return null;
  if (update.status === 'available' && update.installer) {
    return <a aria-label={tr(`Ladda ned JACO CODE-uppdatering ${update.latestVersion}`, `Download JACO CODE update ${update.latestVersion}`)} title={tr('Officiellt installationsprogram från GitHub · Windows begär administratörsgodkännande', 'Official GitHub release installer · Windows administrator approval is required')} href={update.installer.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded border border-neutral-600/60 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800/30">
      <Download size={14}/>{tr('Uppdatera till', 'Update')} v{update.latestVersion}
    </a>;
  }
  if (update.status === 'installer_missing') {
    return <span className="text-[10px] text-amber-300" title={tr('Det finns en nyare version men inget kontrollerat Windows-installationsprogram är publicerat.', 'A newer source release exists but no verified Windows installer was published.')}>{tr('Windows-installation väntar', 'Windows setup pending')} · v{update.latestVersion}</span>;
  }
  return <button type="button" onClick={() => void refresh()} disabled={checking} aria-label={tr('Sök efter uppdateringar av JACO CODE', 'Check for JACO CODE updates')}
    title={tr(`Status för Windows-versionen: ${update.status}. Installerad version v${update.currentVersion}.`, `Windows release status: ${update.status}. Installed runtime v${update.currentVersion}.`)}
    className="inline-flex items-center gap-1 px-1 py-1 text-[10px] text-neutral-400 hover:text-neutral-200">
    <RefreshCw size={13} className={checking ? 'animate-spin' : ''}/>{tr('Uppdateringar', 'Updates')}
  </button>;
}
