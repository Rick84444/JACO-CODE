import React, { useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { isAbsoluteProjectPath, projectLabel } from '../lib/auraProject.mjs';

const PROJECT_ENDPOINT = '/api/aura/workbench/project';

type ProjectData = {
  root?: string;
  git?: boolean;
  history?: string[];
};

export const AuraProjectPicker: React.FC<{ disabled?: boolean; onOpened: (root: string) => void }> = ({
  disabled = false,
  onOpened,
}) => {
  const [project, setProject] = useState<ProjectData>({});
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(PROJECT_ENDPOINT);
        const data = await readAuraResponse(response);
        if (!cancelled) setProject(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openProject = async (root: string) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(PROJECT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: root }),
      });
      const data = await readAuraResponse(response);
      setProject(data);
      setInput('');
      onOpened(data.root);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const history = Array.isArray(project.history) ? project.history : [];
  const canOpen = !disabled && !busy && isAbsoluteProjectPath(input);

  return (
    <div className="flex flex-col gap-1 text-[11px] text-neutral-300">
      <div className="font-bold" title={project.root || ''}>
        {projectLabel(project.root)}
        {project.git ? ' git' : ''}
      </div>
      {disabled ? (
        <div className="text-amber-400">Save or discard edits before switching project</div>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 border border-[#3a3a3a] bg-[#1f1f1f] px-1 py-0.5 text-[11px]"
              placeholder="Absolute folder path"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              className="border border-[#3a3a3a] bg-[#1f1f1f] px-2 py-0.5 text-[11px] disabled:opacity-40"
              disabled={!canOpen}
              onClick={() => openProject(input.trim())}
            >
              Open
            </button>
          </div>
          {history.length > 1 ? (
            <select
              className="border border-[#3a3a3a] bg-[#1f1f1f] px-1 py-0.5 text-[11px]"
              value={project.root || ''}
              onChange={(event) => {
                if (event.target.value) openProject(event.target.value);
              }}
            >
              {history.map((root) => (
                <option key={root} value={root}>
                  {projectLabel(root)}
                </option>
              ))}
            </select>
          ) : null}
        </>
      )}
      {error ? <div className="text-amber-400">{error}</div> : null}
    </div>
  );
};

export default AuraProjectPicker;
