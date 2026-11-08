import React, { useEffect, useState } from 'react';

type ReleaseStatus = {
  status: 'available'|'current'|'unpublished'|'unreachable'|'unsupported'|'invalid_release'|'invalid_version'|'installer_missing';
  currentVersion: string;
  latestVersion?: string;
  installed: boolean;
  installer?: { name: string; url: string; sha256: string|null };
  releaseUrl?: string;
};

export function JacoWindowsUpdateNotice() {
  const [release, setRelease] = useState<ReleaseStatus|null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/runtime/updates', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) return;
        const result = await response.json() as ReleaseStatus;
        if (active) setRelease(result);
      } catch { /* Offline update checks never affect running missions. */ }
    };
    void check();
    const interval = window.setInterval(() => void check(), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!release || release.status !== 'available' || !release.installer) return null;
  return (
    <section role="status" aria-label="JACO Windows update available" className="shrink-0 flex flex-wrap items-center gap-3 border-b border-neutral-900 bg-[#1d1e20] px-4 py-2 text-xs text-neutral-100">
      <strong>JACO update available: v{release.latestVersion}</strong>
      <span className="text-neutral-400">Installed v{release.currentVersion}. Your data is preserved between releases.</span>
      <a href={release.installer.url} target="_blank" rel="noopener noreferrer" className="rounded border border-neutral-500 px-3 py-1 text-neutral-200 hover:bg-neutral-950">
        Download Windows installer
      </a>
      <span className="text-neutral-500">Run Setup and approve the Windows administrator prompt. JACO will not install silently.</span>
    </section>
  );
}
