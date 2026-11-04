import React, { useMemo, useState } from 'react';
import { FileCode2, RotateCcw, X } from 'lucide-react';
import { sanitizeAuraStageHtml } from '../lib/auraSafeHtml.mjs';

export interface CapturedPageData { url: string; title: string; html: string; sha256: string; at: string }

// A page fetched through CDP as cleaned HTML. The original stays immutable; the operator edits a separate
// copy and sees it rendered live. Both render only after sanitizing, in a sandbox without scripts.
// Nothing here writes to a project or to the page.
export const CapturedPage: React.FC<{ page: CapturedPageData; onClose: () => void }> = ({ page, onClose }) => {
  const [draft, setDraft] = useState(page.html);
  const [view, setView] = useState<'copy' | 'original'>('copy');
  const [editing, setEditing] = useState(false);
  const shown = view === 'original' ? page.html : draft;
  const rendered = useMemo(() => {
    try { return { ok: true, html: sanitizeAuraStageHtml(shown) }; }
    catch (error: any) { return { ok: false, html: '', error: String(error?.message || error) }; }
  }, [shown]);
  const changed = draft !== page.html;
  return <div className="aura-captured-page" aria-label="Captured web page">
    <div className="aura-live-cdp-frame-bar">
      <span title={page.url}><FileCode2 size={13} /> {page.title || page.url} · captured {new Date(page.at).toLocaleTimeString()}</span>
      <span className="aura-captured-actions">
        <button type="button" aria-pressed={view === 'copy'} onClick={() => setView('copy')}>Working copy{changed ? ' (changed)' : ''}</button>
        <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button>
        <button type="button" aria-pressed={editing} onClick={() => { setView('copy'); setEditing(v => !v); }}>{editing ? 'Hide HTML' : 'Edit HTML'}</button>
        {changed && <button type="button" onClick={() => setDraft(page.html)}><RotateCcw size={11} /> Reset</button>}
        <button type="button" aria-label="Close captured page" onClick={onClose}><X size={12} /></button>
      </span>
    </div>
    {rendered.ok
      ? <iframe className="aura-captured-frame" title={'Preview: ' + (page.title || page.url)} sandbox="" srcDoc={rendered.html} />
      : <p role="alert" className="aura-live-capture-error">The page could not be displayed safely: {rendered.error}</p>}
    {editing && <textarea className="aura-captured-editor" aria-label="Edit the working copy's HTML" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} />}
    <small>Cleaned copy of the page: without scripts, form values, hidden fields, token metadata and URL parameters. Visible text on the page is included. Changes affect only this copy. Source: {page.url} · sha256 {page.sha256.slice(0, 12)}</small>
  </div>;
};
