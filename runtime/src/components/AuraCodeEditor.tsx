import { readAuraResponse as apiJson } from '../lib/auraApi.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import '../lib/monacoSetup';
import { Save, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface AuraEditorFile {
  path: string;
  content: string;
  language: string;
  size: number;
  hash: string;
}

interface Props {
  file: AuraEditorFile | null;
  draft?: string;
  onDraftChange?: (path: string, content: string) => void;
  onSaved?: (file: AuraEditorFile) => void;
  onDirtyChange?: (dirty: boolean) => void;
}



export const AuraCodeEditor: React.FC<Props> = ({ file, draft, onDraftChange, onSaved, onDirtyChange }) => {
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle'|'saved'|'error'|'conflict'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const editorRef = useRef<any>(null);
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    setSaveState('idle');
    setMessage(null);
    onDirtyChange?.(Boolean(file && (draft ?? file.content) !== file.content));
  }, [file?.path, file?.hash]);

  const value = file ? (draft ?? file.content) : '';
  const dirty = useMemo(() => Boolean(file && value !== file.content), [file, value]);
  useEffect(() => onDirtyChange?.(dirty), [dirty]);

  const save = async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await fetch('/api/aura/workbench/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content: value, expectedHash: file.hash }),
      }).then(apiJson);
      const next: AuraEditorFile = {
        ...file,
        content: value,
        size: Number(data.size || new Blob([value]).size),
        hash: String(data.hash),
      };
      setSaveState('saved');
      setMessage(data.changed ? 'Saved with verified content hash.' : 'No content change.');
      onSaved?.(next);
      window.setTimeout(() => setSaveState('idle'), 1800);
    } catch (error: any) {
      const conflict = String(error?.message || '').includes('WORKBENCH_FILE_CONFLICT');
      setSaveState(conflict ? 'conflict' : 'error');
      setMessage(conflict ? 'File changed on disk. Reload before saving.' : (error?.message || String(error)));
    } finally {
      setSaving(false);
    }
  };

  saveRef.current = () => { void save(); };

  const beforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme('jaco-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editorGutter.background': '#1e1e1e',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
      },
    });
  };

  if (!file) {
    return <div className="h-full flex items-center justify-center text-xs text-slate-500">Open a file from Explorer.</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#1e1e1e]">
      <div className="h-8 px-3 border-b border-[#2b2b2b] flex items-center justify-between text-[10px] text-slate-500 shrink-0">
        <div className="truncate">{file.path}</div>
        <div className="flex items-center gap-2">
          {saveState === 'saved' && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />saved</span>}
          {(saveState === 'error' || saveState === 'conflict') && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{saveState}</span>}
          <span>{dirty ? '● modified' : 'saved'} · {file.language}</span>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="px-2 py-1 border border-[#3b3b3b] rounded text-slate-300 hover:bg-[#2a2d2e] disabled:opacity-30 flex items-center gap-1"
            title="Save (Ctrl/Cmd+S)"
          >
            {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
      {message && <div className={`px-3 py-1 text-[10px] border-b border-[#2b2b2b] ${saveState === 'error' || saveState === 'conflict' ? 'text-amber-300 bg-amber-950/20' : 'text-slate-400'}`}>{message}</div>}
      <div className="flex-1 min-h-0">
        <Editor
          path={file.path}
          language={file.language}
          value={value}
          theme="jaco-dark"
          beforeMount={beforeMount}
          onMount={(editor) => {
            editorRef.current = editor;
            editor.addCommand(2048 | 49, () => saveRef.current());
          }}
          onChange={(next) => {
            if (file) onDraftChange?.(file.path, next ?? '');
            setSaveState('idle');
          }}
          options={{
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 13,
            lineHeight: 20,
            fontLigatures: true,
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            stickyScroll: { enabled: true },
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            folding: true,
            glyphMargin: true,
          }}
        />
      </div>
    </div>
  );
};

export default AuraCodeEditor;
