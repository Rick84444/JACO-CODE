import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Wrench, ShieldCheck, X } from 'lucide-react';
import { AURA_PRODUCT_TOOLS, type AuraProductTool } from '../lib/auraToolRegistry';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenTool: (tool: AuraProductTool) => void;
}

export const AuraCommandPalette: React.FC<Props> = ({ open, onClose, onOpenTool }) => {
  const { t: uiText, language } = useUiLanguage();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q
      ? AURA_PRODUCT_TOOLS.filter(tool =>
          [tool.id, tool.title, uiText(tool.title), tool.description, uiText(tool.description), tool.category, uiText(tool.category), tool.command, ...tool.aliases]
            .some(value => String(value).toLowerCase().includes(q)))
      : AURA_PRODUCT_TOOLS;
    return source.slice(0, 80);
  }, [query, language]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] bg-black/45 backdrop-blur-[1px] flex items-start justify-center pt-[10vh]" onMouseDown={onClose}>
      <div className="w-[min(760px,92vw)] max-h-[70vh] bg-[#1f1f1f] border border-[#454545] shadow-2xl rounded-md overflow-hidden" onMouseDown={event => event.stopPropagation()}>
        <div className="h-12 flex items-center gap-2 px-3 border-b border-[#343434]">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && items[0]) {
                onOpenTool(items[0]);
                onClose();
              }
            }}
            placeholder={uiText("Type a command or capability…")}
            className="flex-1 bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
          />
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-auto max-h-[calc(70vh-3rem)] py-1">
          {items.map(tool => (
            <button
              key={tool.id}
              onClick={() => { onOpenTool(tool); onClose(); }}
              className="w-full text-left px-3 py-2 hover:bg-[#094771] flex items-start gap-3"
            >
              <Wrench className="w-4 h-4 mt-0.5 text-cyan-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-100">{uiText(tool.title)}</span>
                  <span className="text-[9px] text-slate-500">{uiText(tool.category)}</span>
                  {tool.authority !== 'ALLOW' && (
                    <span className="text-[9px] border border-amber-800 text-amber-300 rounded px-1 flex items-center gap-1">
                      <ShieldCheck className="w-2.5 h-2.5" />{uiText(tool.authority === 'REVIEW' ? 'Approval required' : 'Verification required')}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{uiText(tool.description)}</div>
              </div>
              <span className="text-[9px] font-mono text-slate-600 shrink-0">{tool.command}</span>
            </button>
          ))}
          {!items.length && <div className="p-5 text-xs text-slate-500">{uiText("No matching capability.")}</div>}
        </div>
      </div>
    </div>
  );
};

export default AuraCommandPalette;
