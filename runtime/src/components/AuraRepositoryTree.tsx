import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, Loader2 } from 'lucide-react';

export interface AuraTreeFile {
  path: string;
  size: number;
}

export interface AuraGitChange {
  path: string;
  index: string;
  worktree: string;
  status: string;
}

interface AuraDirectoryEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number | null;
}

interface Props {
  files: AuraTreeFile[];
  selectedPath: string | null;
  query?: string;
  gitChanges?: AuraGitChange[];
  onOpen: (path: string) => void;
}

interface SearchNode {
  kind: 'folder' | 'file';
  name: string;
  path: string;
  file?: AuraTreeFile;
  children: Map<string, SearchNode>;
}

const makeFolder = (name: string, path: string): SearchNode => ({
  kind: 'folder',
  name,
  path,
  children: new Map(),
});

const buildSearchTree = (files: AuraTreeFile[], query: string) => {
  const root = makeFolder('workspace', '');
  const needle = query.trim().toLowerCase();
  for (const file of files) {
    if (needle && !file.path.toLowerCase().includes(needle)) continue;
    const parts = file.path.split('/').filter(Boolean);
    let parent = root;
    let currentPath = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = parent.children.get(part);
      if (!node) {
        node = isFile
          ? { kind: 'file', name: part, path: currentPath, file, children: new Map() }
          : makeFolder(part, currentPath);
        parent.children.set(part, node);
      }
      parent = node;
    }
  }
  return root;
};

const sortSearchNodes = (nodes: Iterable<SearchNode>) => [...nodes].sort((a, b) => {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
});

const ancestors = (path: string | null) => {
  if (!path) return [];
  const parts = path.split('/').filter(Boolean);
  const rows: string[] = [];
  for (let index = 1; index < parts.length; index += 1) rows.push(parts.slice(0, index).join('/'));
  return rows;
};

const json = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) throw new Error(body?.error || `HTTP_${response.status}`);
  return body;
};

export const AuraRepositoryTree: React.FC<Props> = ({
  files,
  selectedPath,
  query = '',
  gitChanges = [],
  onOpen,
}) => {
  const { t: uiText } = useUiLanguage();
  const gitByPath = useMemo(() => new Map(gitChanges.map(change => [change.path, change])), [gitChanges]);
  const searchTree = useMemo(() => buildSearchTree(files, query), [files, query]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [directories, setDirectories] = useState<Record<string, AuraDirectoryEntry[]>>({});
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const revealRun = useRef(0);
  const searching = Boolean(query.trim());

  const loadDirectory = async (path: string, force = false) => {
    if (!force && directories[path]) return directories[path];
    if (loading.has(path)) return null;

    setLoading(current => new Set(current).add(path));
    setLoadErrors(current => {
      const next = { ...current };
      delete next[path];
      return next;
    });

    try {
      const data = await fetch(`/api/aura/workbench/tree?path=${encodeURIComponent(path)}`, { cache: 'no-store' }).then(json);
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setDirectories(current => ({ ...current, [path]: entries }));
      return entries as AuraDirectoryEntry[];
    } catch (error: any) {
      setLoadErrors(current => ({ ...current, [path]: error?.message || String(error) }));
      return null;
    } finally {
      setLoading(current => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  };

  useEffect(() => {
    void loadDirectory('');
    // The directory cache itself is intentionally not a dependency: the root
    // probe runs once and subsequent refreshes are explicit through folder open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPath || searching) return;
    const run = ++revealRun.current;
    const reveal = async () => {
      const rows = ancestors(selectedPath);
      let parent = '';
      for (const path of rows) {
        if (run !== revealRun.current) return;
        setExpanded(current => new Set(current).add(path));
        await loadDirectory(parent);
        parent = path;
        await loadDirectory(parent);
      }
    };
    void reveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, searching]);

  const toggleDirectory = async (path: string) => {
    const open = expanded.has(path);
    setExpanded(current => {
      const next = new Set(current);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!open) await loadDirectory(path);
  };

  const renderLazyEntry = (entry: AuraDirectoryEntry, depth: number): React.ReactNode => {
    if (entry.kind === 'directory') {
      const open = expanded.has(entry.path);
      const children = directories[entry.path] || [];
      const isLoading = loading.has(entry.path);
      return (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() => void toggleDirectory(entry.path)}
            className="w-full h-6 flex items-center text-left text-[11px] text-slate-300 hover:bg-[#2a2d2e]"
            style={{ paddingLeft: `${6 + depth * 12}px` }}
            title={entry.path}
          >
            {isLoading
              ? <Loader2 className="w-3 h-3 text-slate-500 shrink-0 animate-spin" />
              : open
                ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
                : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
            {open ? <FolderOpen className="w-3.5 h-3.5 ml-0.5 mr-1.5 text-sky-400/80 shrink-0" /> : <Folder className="w-3.5 h-3.5 ml-0.5 mr-1.5 text-sky-400/70 shrink-0" />}
            <span className="truncate">{entry.name}</span>
          </button>
          {open && children.map(child => renderLazyEntry(child, depth + 1))}
          {open && loadErrors[entry.path] && (
            <div className="text-[9px] text-amber-400 px-2 py-1" style={{ paddingLeft: `${25 + depth * 12}px` }}>
              {loadErrors[entry.path]}
            </div>
          )}
        </div>
      );
    }

    const change = gitByPath.get(entry.path);
    return (
      <button
        key={entry.path}
        type="button"
        onClick={() => onOpen(entry.path)}
        className={`w-full h-6 flex items-center text-left text-[11px] hover:bg-[#2a2d2e] ${selectedPath === entry.path ? 'bg-[#37373d] text-white' : 'text-slate-300'}`}
        style={{ paddingLeft: `${21 + depth * 12}px` }}
        title={`${entry.path}${entry.size != null ? ` · ${entry.size} bytes` : ''}`}
      >
        <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-sky-400 shrink-0" />
        <span className="truncate">{entry.name}</span>
        {change && <span className="ml-auto mr-2 text-[9px] font-mono text-amber-300">{change.status.trim() || 'M'}</span>}
      </button>
    );
  };

  const renderSearchNode = (node: SearchNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      return (
        <div key={node.path || node.name}>
          <div
            className="w-full h-6 flex items-center text-left text-[11px] text-slate-400"
            style={{ paddingLeft: `${6 + depth * 12}px` }}
          >
            <ChevronDown className="w-3 h-3 text-slate-600 shrink-0" />
            <FolderOpen className="w-3.5 h-3.5 ml-0.5 mr-1.5 text-sky-400/60 shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
          {sortSearchNodes(node.children.values()).map(child => renderSearchNode(child, depth + 1))}
        </div>
      );
    }
    const change = gitByPath.get(node.path);
    return (
      <button
        key={node.path}
        type="button"
        onClick={() => onOpen(node.path)}
        className={`w-full h-6 flex items-center text-left text-[11px] hover:bg-[#2a2d2e] ${selectedPath === node.path ? 'bg-[#37373d] text-white' : 'text-slate-300'}`}
        style={{ paddingLeft: `${21 + depth * 12}px` }}
        title={node.path}
      >
        <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-sky-400 shrink-0" />
        <span className="truncate">{node.name}</span>
        {change && <span className="ml-auto mr-2 text-[9px] font-mono text-amber-300">{change.status.trim() || 'M'}</span>}
      </button>
    );
  };

  if (searching) {
    const nodes = sortSearchNodes(searchTree.children.values());
    return (
      <div className="flex-1 min-h-0 overflow-auto" aria-label={uiText("Repository tree search results")}>
        {nodes.map(node => renderSearchNode(node, 0))}
        {!nodes.length && <div className="p-3 text-[10px] text-slate-600">{uiText("No files match the current filter.")}</div>}
      </div>
    );
  }

  const rootEntries = directories[''] || [];
  return (
    <div className="flex-1 min-h-0 overflow-auto" aria-label={uiText("Repository tree")}>
      {rootEntries.map(entry => renderLazyEntry(entry, 0))}
      {loading.has('') && !rootEntries.length && <div className="p-3 text-[10px] text-slate-500">{uiText("Loading workspace…")}</div>}
      {loadErrors[''] && <div className="p-3 text-[10px] text-amber-400">{loadErrors['']}</div>}
      {!loading.has('') && !loadErrors[''] && !rootEntries.length && <div className="p-3 text-[10px] text-slate-600">{uiText("No supported workspace entries observed.")}</div>}
    </div>
  );
};

export default AuraRepositoryTree;
