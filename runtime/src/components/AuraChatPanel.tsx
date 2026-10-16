import { timestampChatMessages } from '../lib/auraRecovery.mjs';
import { readAuraResponse as apiJson } from '../lib/auraApi.mjs';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Search as SearchIcon, Bot, ArrowUp, ArrowDown, Square, Send, Target, Loader2, FileCode2, Settings2, ArrowUpRight, MessageSquare, ChevronRight } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import { JacoWordmark } from './JacoWordmark';
import { CognitiveEventCard } from './CognitiveEventCard';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { safeCognitiveText } from '../lib/cognitiveEvents.mjs';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
  at?: string;
  // A failed message explains itself and offers the one thing to do about it (server: chatFailureHint).
  action?: { code: string; label: string; retryText?: string };
}

export interface AuraSelectedTool {
  kind: 'agent' | 'mcp' | 'skill';
  id: string;
  label: string;
  provider?: string;
  skillId?: string;
  skillSource?: string;
  agentId?: string;
  agentName?: string;
  toolName: string;
  inputSchema?: Record<string, any>;
  readOnly?: boolean;
}

interface AuraChatActivity {
  id: string;
  at: string | null;
  source: string;
  type: string;
  verified: boolean | null;
  message: string | null;
  payload?: any;
}

export function useAuraChatSession() {
  const [messages, updateMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'system',
    content: 'Fråga om arbetsytan eller skapa ett uppdrag. Anslutningsstatus avgörs när ett anrop görs.',
  }]);
  const setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> = action => updateMessages(current => timestampChatMessages(typeof action === 'function' ? action(current) : action));
  const [input, setInput] = useState('');
  const [chatPhase, setChatPhase] = useState<'saving'|'model'|null>(null);
  const chatController = useRef<AbortController|null>(null);
  const [busy, setBusy] = useState<'chat'|'goal'|'tool'|null>(null);
  const [toolArguments, setToolArguments] = useState('{}');
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string|null>(null);
  const [storageRevision, setStorageRevision] = useState(0);
  useEffect(() => {
    let active = true, retryTimer: number | undefined;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await fetch('/api/aura/chat/session', {cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(apiJson);
        if (!active) return;
        setMessages(current => { const existing = new Set(current.map(m=>m.id)); return [...(data.messages || []).filter((m:ChatMessage)=>!existing.has(m.id)), ...current]; });
        setStorageReady(true); setStorageError(null);
      } catch(error:any) {
        if (!active) return;
        setStorageError(`Chatthistoriken kunde inte läsas: ${safeCognitiveText(error.message)}`);
        retryTimer=window.setTimeout(load,5000);
      }
    };
    void load();
    return () => {active=false;controller.abort();window.clearTimeout(retryTimer);};
  }, [storageRevision]);
  const retryStorage = () => setStorageRevision(value=>value+1);
  const appendMessage = async (message:ChatMessage, signal?:AbortSignal) => {
    try {
      const data=await fetch('/api/aura/chat/session/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)}).then(apiJson);
      setMessages(current=>current.some(m=>m.id===data.message.id)?current:[...current,data.message]);setStorageError(null);
    } catch(error:any) {
      // Keep the actual answer visible, but explicitly report that durable storage failed.
      setMessages(current=>current.some(m=>m.id===message.id)?current:[...current,{...message,at:new Date().toISOString()}]);setStorageError(`Meddelandet visas men sparandet kunde inte bekräftas: ${error.message}`);
      if (message.role === 'user') throw error;
      return null;
    }
  };
  return { messages, setMessages, appendMessage, storageReady, storageError, retryStorage, input, setInput, busy, setBusy, toolArguments, setToolArguments, chatPhase, setChatPhase, chatController };
}

interface Props {
  session: ReturnType<typeof useAuraChatSession>;
  onOpenProviders?: () => void;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  selectedTool?: AuraSelectedTool | null;
  onClearSelectedTool?: () => void;
  onStartGoal: (goal: string, selectedTool?: AuraSelectedTool | null) => Promise<any> | void;
  liveEvents?: CognitiveEvent[];
  liveConnection?: string;
  historyTruncated?: boolean;
  runtimeRunning?: boolean;
  runtimeError?: string|null;
  onOpenEvidence?: (event:CognitiveEvent)=>void;
  onOpenFile?: (path:string)=>void;
  activity?: AuraChatActivity[];
  missions?: Array<{id:string;goal:string;status:string;cancelRequested?:boolean}>;
  onCancelMission?: (id:string)=>Promise<void>;
  // Opens the IDE's view of the running work (Missions panel).
  onOpenWork?: () => void;
}



// Like readAuraResponse, but keeps the server's plain-language hint on the error so the chat can show it.
async function chatJson(response: Response) {
  let data: any;
  try { data = await response.json(); } catch { throw new Error(`API_INVALID_JSON: HTTP_${response.status}`); }
  if (!response.ok || data?.success === false) throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : `HTTP_${response.status}`), { hint: data?.hint });
  return data;
}

export const AuraChatPanel: React.FC<Props> = ({ session, activeFilePath, activeFileContent, selectedTool, onClearSelectedTool, onStartGoal, onOpenProviders, activity = [], missions = [], onCancelMission, onOpenWork, liveEvents = [], liveConnection, historyTruncated = false, runtimeError, onOpenEvidence, onOpenFile }) => {
  const { messages, setMessages, appendMessage, storageReady, storageError, retryStorage, input, setInput, busy, setBusy, toolArguments, setToolArguments, chatPhase, setChatPhase, chatController } = session;
  const pendingChat = useRef<{text:string;id:string}|null>(null);
  const [chatModel, setChatModel] = useState('seer');
  const [configuredModel, setConfiguredModel] = useState('seer');
  const [modelOverride, setModelOverride] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('seer');
  const [customModel, setCustomModel] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; local: boolean; defaultModel: string; models: string[]; pricedModels: string[]; credentialReady: boolean }>>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const selectionKey = 'jaco:aura:chat-provider:v2';
  const saveSelection = (provider: string, model: string) => {
    try { localStorage.setItem(selectionKey, JSON.stringify({ provider, model })); } catch {}
    setModelOverride(true);
  };
  const modelStorageKey = 'jaco:aura:chat-model:v1';

  useEffect(() => {
    let active = true;
    fetch('/api/aura/chat/models').then(apiJson).then(data => {
      if (active && Array.isArray(data.cloud)) {
        const available = data.cloud.filter((model: unknown) => typeof model === 'string') as string[];
        const configured = typeof data.default === 'string' ? data.default : 'seer';
        setConfiguredModel(configured);
        let saved: string | null = null;
        try { saved = localStorage.getItem(modelStorageKey); } catch {}
        const valid = saved === 'seer' || available.some(model => saved === `ollama:${model}`);
        setChatModel(valid ? saved! : configured);
        setModelOverride(Boolean(valid && saved !== configured));
        const registered = Array.isArray(data.providers) ? data.providers : [];
        setProviders(registered);
        let choice: any = null;
        try { choice = JSON.parse(localStorage.getItem(selectionKey) || 'null'); } catch {}
        const defaultChoice = { provider: 'seer', model: '' };
        const legacy = valid ? saved! : configured;
        const chosen = choice && typeof choice.provider === 'string' && typeof choice.model === 'string'
          ? choice : legacy.startsWith('ollama:') ? { provider: 'ollama', model: legacy.slice(7) } : defaultChoice;
        setSelectedProvider(chosen.provider);
        setChatModel(chosen.model || '');
        setModelOverride(Boolean(choice || valid));
        setCatalogError(chosen.provider !== 'seer' && !registered.some((p: any) => p.id === chosen.provider) ? 'Sparad provider är inte registrerad. Registrera den igen innan du skickar.' : null);
      }
    }).catch(error => { if (active) setCatalogError(`Providerlista otillgänglig: ${error.message}`); });
    return () => { active = false; };
  }, [catalogRevision]);

  // The Providers panel's "Använd" changed the shared choice: read it again.
  useEffect(() => {
    const again = () => setCatalogRevision(v => v + 1);
    window.addEventListener('jaco:aura:provider-chosen', again);
    return () => window.removeEventListener('jaco:aura:provider-chosen', again);
  }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('jaco:aura:prefill');
      if (pending?.trim()) {
        setInput(pending.trim());
        sessionStorage.removeItem('jaco:aura:prefill');
      }
    } catch {}
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const text = typeof detail === 'string' ? detail : detail?.text;
      if (typeof text === 'string' && text.trim()) setInput(text.trim());
    };
    window.addEventListener('jaco:aura:prefill', prefill);
    return () => window.removeEventListener('jaco:aura:prefill', prefill);
  }, []);

  const [closingMission,setClosingMission]=useState<string|null>(null);
  const [closeError,setCloseError]=useState<string|null>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const followRef=useRef(true);
  const [composeMode,setComposeMode]=useState<'chat'|'goal'>('chat');
  const [following,setFollowing]=useState(true);
  const feed=useMemo(()=>[
    ...messages.filter(m=>m.id!=='welcome').map(message=>({kind:'message' as const,id:message.id,at:message.at||'',message})),
    ...liveEvents.map(event=>({kind:'event' as const,id:event.id,at:event.at,event})),
  ].sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)),[messages,liveEvents]);
  const currentMission=missions.find(m=>m.status==='ACTIVE') || missions.find(m=>m.status==='AWAITING_VERIFICATION') || missions.find(m=>m.status==='BLOCKED') || null;
  const followLatest=()=>{followRef.current=true;setFollowing(true);if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;};
  useEffect(()=>{if(followRef.current && scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[feed,busy]);
  const [showSettings,setShowSettings]=useState(false);
  const inputRef=useRef<HTMLTextAreaElement>(null);
  // The input grows with its text, up to about ten lines.
  useEffect(()=>{const el=inputRef.current;if(!el)return;el.style.height='auto';el.style.height=`${Math.min(260,el.scrollHeight)}px`;},[input]);
  useEffect(()=>{const focus=()=>inputRef.current?.focus();window.addEventListener('jaco:aura:focus',focus);return()=>window.removeEventListener('jaco:aura:focus',focus);},[]);
  const modelLabel=selectedProvider==='seer'?'JACO standard':`${selectedProvider}${chatModel?` / ${chatModel}`:''}`;

  const ask = async (retry?: string) => {
    const text = (retry ?? input).trim();
    if (!text || busy || !storageReady) return;
    if (selectedProvider !== 'seer' && (!providers.some(p => p.id === selectedProvider) || !chatModel.trim())) {
      setCatalogError('Välj en registrerad provider och ange modell före anrop.');
      return;
    }
    const id = pendingChat.current?.text === text ? pendingChat.current.id : crypto.randomUUID();
    pendingChat.current = { text, id };
    const user: ChatMessage = { id, role: 'user', content: text };
    const controller = new AbortController();
    chatController.current = controller;
    let phase: 'saving'|'model' = 'saving';
    setChatPhase(phase);
    setBusy('chat');
    const started = performance.now();
    try {
      if (retry === undefined) await appendMessage(user, controller.signal);
      if (retry === undefined) setInput(current => current === input ? '' : current);
      controller.signal.throwIfAborted();
      phase = 'model'; setChatPhase(phase);
      const ragContext: Array<{ source: string; content: any }> = [];
      if (liveEvents.length || currentMission) ragContext.push({
        source:'jaco://current-work',
        content:{
          connection:liveConnection,
          mission:currentMission ? {id:currentMission.id,goal:safeCognitiveText(currentMission.goal),status:currentMission.status} : null,
          events:liveEvents.slice(-12).map(event=>({id:event.id,at:event.at,missionId:event.missionId,text:event.text,outcome:event.evidence.outcome})),
          instruction:'These are observed runtime events, not inferred thoughts. Explain what is supported, preserve unknown outcomes, and do not change or restart the mission to answer a question.',
        },
      });
      if (activeFilePath) ragContext.push({
        source: activeFilePath,
        content: String(activeFileContent || '').slice(0, 12000),
      });
      if (selectedTool) ragContext.push({
        source: `jaco://tool/${selectedTool.id}`,
        content: {
          kind: selectedTool.kind,
          label: selectedTool.label,
          provider: selectedTool.provider || null,
          agentId: selectedTool.agentId || null,
          agentName: selectedTool.agentName || null,
          toolName: selectedTool.toolName,
          inputSchema: selectedTool.inputSchema || null,
          authorityNote: 'This selection is context only. Existing JACO authority gates still control execution.',
        },
      });
      const data = await fetch('/api/aura/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          interactionMode: 'question',
          selectedProvider,
          model: selectedProvider === 'seer' ? undefined : chatModel,
          activeFilePath: activeFilePath || null,
          targetSubAgent: selectedTool?.kind === 'agent' ? (selectedTool.agentName || selectedTool.agentId) : undefined,
          messagesHistory: [...messages.filter(m => m.role !== 'system' && m.id !== id).slice(-20).map(m => ({role:m.role === 'assistant' ? 'model' : 'user',content:m.content})), { role: 'user', content: text }],
          ragContext,
        }),
        // Longer than SEER's own provider chain; a hung request still ends in a message.
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]),
      }).then(chatJson);
      const answer=String(data.reply || data.text || '').trim();
      if(!answer) throw new Error('Modellen returnerade ett tomt svar.');
      await appendMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: answer,
        // Show which tools produced the evidence behind the answer.
        meta: [
          data.degraded ? 'JACO:s statussvar, ingen modell kunde svara' : null,
          data.fallback ? `${data.fallback.from} kunde inte svara (${String(data.fallback.reason).slice(0, 60)}), svarade via JACO:s standardanslutning` : null,
          data.modelUsed || [data.provider, data.model].filter(Boolean).join('/'),
          `${((performance.now() - started) / 1000).toFixed(1)} s`,
          data.providerReceipt?.costStatus === 'SETTLED'
            ? `Cloud $${Number(data.providerReceipt.costUsd || 0).toFixed(4)}`
            : data.providerReceipt?.costStatus === 'OUTCOME_UNKNOWN' ? 'Cloud cost pending reconciliation' : null,
          Array.isArray(data.toolReceipts) && data.toolReceipts.length
            ? `tools: ${data.toolReceipts.map((r: any) => `${r.name} ${r.ok ? 'ok' : 'failed'}`).join(', ')}`
            : null,
        ].filter(Boolean).join(' · '),
      }, controller.signal);
      pendingChat.current = null;
      // No model answered and Aura gave its status answer: offer the one thing that would fix it.
      if (data.degraded && data.hint?.action) {
        setMessages(current => [...current, {
          id: crypto.randomUUID(), role: 'system', content: data.hint.message,
          action: { code: data.hint.action, label: data.hint.actionLabel || 'Öppna', retryText: text },
        }]);
      }
    } catch (error: any) {
      if(retry === undefined) setInput(current=>current || text);
      const hint = error?.hint;
      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        role: 'system',
        // The runtime itself did not answer (stopped, restarting, or the request timed out); a refusal it did send carries a hint.
        content: controller.signal.aborted ? 'Väntan avbröts. Servern kan fortfarande behandla anropet. Pågående uppdrag har inte avbrutits.' : hint?.message || (error?.name === 'TimeoutError'
          ? phase === 'saving' ? 'Sparandet kunde inte bekräftas inom tio sekunder. Texten är kvar; kontrollera anslutningen innan du skickar igen.' : 'JACO fick inget svar från runtime på fyra minuter. Kontrollera anslutningen innan du skickar igen.'
          : `Chatten svarade inte: ${error?.message || String(error)}`),
        ...(hint?.action ? { action: { code: hint.action, label: hint.actionLabel || 'Öppna', retryText: text } } : {}),
      }]);
    } finally {
      chatController.current = null; setChatPhase(null);
      setBusy(null);
    }
  };

  // The button under a failed message: turn cloud on and send the same message again, or open Providers.
  const runAction = async (action: NonNullable<ChatMessage['action']>) => {
    if (action.code === 'enable-cloud') {
      try {
        await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cloudEnabled: true }) }).then(apiJson);
        window.dispatchEvent(new Event('jaco:economic:refresh'));
        if (action.retryText) void ask(action.retryText);
      } catch (error: any) {
        setMessages(current => [...current, { id: crypto.randomUUID(), role: 'system', content: `Kunde inte slå på moln: ${error?.message || String(error)}` }]);
      }
      return;
    }
    onOpenProviders?.();
  };

  const runSelectedTool = async () => {
    if (!selectedTool || !['mcp','skill'].includes(selectedTool.kind) || busy) return;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolArguments || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object');
    } catch (error: any) {
      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Invalid tool arguments: ${error?.message || String(error)}`,
      }]);
      return;
    }
    setBusy('tool');
    try {
      const isSkill = selectedTool.kind === 'skill';
      const endpoint = isSkill
        ? `/api/aura/workbench/skills/${encodeURIComponent(selectedTool.skillId || selectedTool.toolName)}/execute`
        : '/api/aura/workbench/mcp/call';
      const payload = isSkill
        ? { source: selectedTool.skillSource || null, arguments: args }
        : {
            providerId: selectedTool.provider,
            toolName: selectedTool.toolName,
            arguments: args,
          };
      const data = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(apiJson);
      const compact = JSON.stringify(data.result ?? data, null, 2);
      await appendMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: compact.length > 10000 ? `${compact.slice(0,10000)}\n…truncated…` : compact,
        meta: isSkill
          ? `Skill receipt · ${selectedTool.skillId || selectedTool.toolName}`
          : `MCP receipt · ${selectedTool.provider}.${selectedTool.toolName}`,
      });
    } catch (error: any) {
      setMessages(current => [...current, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `${selectedTool.kind === 'skill' ? 'Skill' : 'MCP tool'} failed: ${error?.message || String(error)}`,
      }]);
    } finally {
      setBusy(null);
    }
  };

  const goal = async () => {
    const text=input.trim();
    if(!text || busy || !storageReady)return;
    setBusy('goal');
    try {
      await appendMessage({id:crypto.randomUUID(),role:'user',content:text});
      const accepted=await onStartGoal(text,selectedTool);
      if(!accepted?.goal?.id)throw new Error('Runtime bekräftade inte uppdragets ID.');
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdraget är registrerat. Planering och resultat visas här när runtime rapporterar dem.',meta:'Uppdrag: '+accepted.goal.id});
      setInput('');setComposeMode('chat');
    } catch(error:any) {
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdragets registrering kunde inte bekräftas: '+safeCognitiveText(error?.message || String(error))});
    } finally {setBusy(null);}
  };
  const submit=()=>composeMode==='goal'?goal():ask();
  const prompt=(text:string,mode:'chat'|'goal'='chat')=>{setInput(text);setComposeMode(mode);inputRef.current?.focus();};
  const activeDetail=currentMission as any;
  const latestMissionObservation=currentMission ? liveEvents.filter(event=>event.missionId===currentMission.id).at(-1) : null;

  return (
    <div className="cognitive-chat h-full min-h-0 flex flex-col">
      <div className="cognitive-chat-heading">
        <span><span className="cognitive-jaco-mark"/>JACO <span className="cognitive-chat-subtitle">Samtal & skapande</span></span>
        <button type="button" onClick={()=>setShowSettings(v=>!v)} aria-expanded={showSettings} aria-label="Chattinställningar" title="Modell och budget"><Settings2 size={15}/><span>{modelLabel}</span></button>
      </div>

      {showSettings && (
        <div className="px-4 py-3 border-b border-[#1c2a36] bg-[#0e1720] space-y-2 text-xs max-h-[50%] overflow-auto">
          <label className="flex items-center gap-2 text-slate-400">Modell
            <select aria-label="Aura provider" value={selectedProvider} onChange={event => {
              const next = event.target.value;
              const model = providers.find(p => p.id === next)?.defaultModel || '';
              setSelectedProvider(next); setChatModel(model); saveSelection(next, model);
            }} disabled={busy !== null || !storageReady}
              className="flex-1 min-w-0 bg-[#111820] border border-[#343b45] rounded px-2 py-1 text-xs text-slate-200">
              <option value="seer">JACO standard</option>
              {selectedProvider !== 'seer' && !providers.some(p => p.id === selectedProvider) && <option value={selectedProvider}>{selectedProvider} · ej registrerad</option>}
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.id}{provider.credentialReady ? '' : ' · credential saknas'}</option>)}
            </select>
          </label>
          {selectedProvider !== 'seer' && (() => {
            // A list to pick from (a datalist does not open on most phones); typing a name stays possible.
            const listed = providers.find(p => p.id === selectedProvider)?.models || [];
            const typed = customModel || listed.length === 0;
            const pick = (model: string) => { setChatModel(model); saveSelection(selectedProvider, model); };
            return typed
              ? <div className="flex gap-2">
                  <input aria-label="Aura modell" value={chatModel} maxLength={128} disabled={busy !== null || !storageReady} onChange={e => pick(e.target.value)} placeholder="Modellnamn" className="flex-1 min-w-0 text-sm px-2 py-1.5 bg-[#111820] border border-[#343b45] rounded" />
                  {listed.length > 0 && <button type="button" className="text-[11px] text-cyan-400" onClick={() => { setCustomModel(false); if (!listed.includes(chatModel)) pick(listed[0]); }}>Välj ur lista</button>}
                </div>
              : <select aria-label="Aura modell" value={listed.includes(chatModel) ? chatModel : ''} disabled={busy !== null || !storageReady}
                  onChange={e => e.target.value === '__other' ? setCustomModel(true) : pick(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 bg-[#111820] border border-[#343b45] rounded text-slate-200">
                  {!listed.includes(chatModel) && <option value="">{chatModel || 'Välj modell'}</option>}
                  {listed.map(model => <option key={model} value={model}>{model}</option>)}
                  <option value="__other">Annan modell…</option>
                </select>;
          })()}
          <div className="flex flex-wrap gap-3 text-[11px] text-cyan-400">
            <button disabled={busy !== null || !storageReady} onClick={() => setCatalogRevision(v => v + 1)}>Uppdatera providerlista</button>
            {onOpenProviders && <button onClick={onOpenProviders}>Hantera providers</button>}
            {modelOverride && <button type="button" disabled={busy !== null || !storageReady} onClick={() => {
              setSelectedProvider(configuredModel.startsWith('ollama:') ? 'ollama' : 'seer');
              setChatModel(configuredModel.startsWith('ollama:') ? configuredModel.slice(7) : '');
              setModelOverride(false);
              try { localStorage.removeItem(modelStorageKey); localStorage.removeItem(selectionKey); } catch {}
            }} title="Use the model configured in JACO">Standardmodell</button>}
          </div>
          {selectedProvider !== 'seer' && providers.find(p => p.id === selectedProvider) && !providers.find(p => p.id === selectedProvider)!.credentialReady && <p className="text-[11px] text-amber-300">Provider saknar konfigurerad credential.</p>}
        </div>
      )}
      {catalogError && <p role="alert" className="px-4 py-2 text-xs text-amber-300 border-b border-[#1c2a36]">{catalogError}</p>}
      {storageError && <div role="alert" className="px-4 py-2 text-xs text-amber-300">{storageError}{!storageReady&&<button type="button" className="ml-3 underline" onClick={retryStorage}>Försök läsa igen</button>}</div>}

      <div ref={scrollRef} onScroll={()=>{const el=scrollRef.current;if(el){const near=el.scrollHeight-el.scrollTop-el.clientHeight<80;followRef.current=near;setFollowing(near);}}} role="log" aria-live="polite" aria-relevant="additions" aria-label="JACO-konversation" className="cognitive-chat-scroll">
        <div className="cognitive-feed">
          {!storageReady && !storageError && <p className="cognitive-muted">Läser din sparade konversation…</p>}
          {historyTruncated&&<p className="cognitive-history-note">Det senaste arbetet visas. Äldre händelser finns kvar i uppdragshistoriken.</p>}
          {storageReady&&feed.length===0&&<div className="cognitive-welcome">
            <JacoWordmark size="lg"/>
            <div className="cognitive-section-kicker">Din idé. Ett sammanhängande arbete.</div>
            <h1>Vad vill du skapa?</h1>
            <p>Beskriv det du vill få att fungera.<br/>Följ arbetet, pröva resultatet och forma nästa steg tillsammans.</p>
            <div className="cognitive-start-prompts">
              <button type="button" onClick={()=>prompt('Undersök det öppna projektet. Förklara vad som fungerar och vilka fel du faktiskt kan verifiera.','goal')}><SearchIcon/><span>Undersök mitt projekt<small>Förstå koden och nästa steg</small></span><ArrowUpRight size={14}/></button>
              <button type="button" onClick={()=>prompt('Hjälp mig förbättra en funktion i projektet. Börja med att kartlägga den relevanta koden.')}><FileCode2 size={17}/><span>Utveckla vidare<small>Bygg på det som redan finns</small></span><ArrowUpRight size={14}/></button>
            </div>
          </div>}
          {feed.map(item=>{
            if(item.kind==='event')return <CognitiveEventCard key={item.id} event={item.event} onInspect={onOpenEvidence} onOpenFile={onOpenFile}/>;
            const message=item.message;
            return message.role==='user'?<div key={item.id} className="cognitive-user-message"><div>{message.content}</div></div>
              :message.role==='assistant'?<article key={item.id} className="cognitive-assistant-message"><div className="cognitive-message-author"><span className="cognitive-jaco-mark"/>JACO</div><ChatMarkdown text={message.content}/>{message.meta&&<details className="cognitive-message-meta"><summary>Svar & källor</summary><p>{message.meta}</p></details>}</article>
              :<div key={item.id} className="cognitive-system-message">{message.content}{message.action&&<button type="button" disabled={busy!==null} onClick={()=>void runAction(message.action!)}>{message.action.label}</button>}</div>;
          })}
          {busy&&<div className="cognitive-response-wait" role="status"><Loader2 size={15} className="animate-spin"/>{busy==='goal'?'Registrerar uppdraget…':busy==='tool'?'Väntar på verktygets resultat…':chatPhase==='saving'?'Sparar meddelandet…':'Väntar på modellens svar…'}{busy==='chat'&&<button type="button" onClick={()=>chatController.current?.abort()} className="cognitive-primary-outline">Avbryt väntan</button>}</div>}
        </div>
      </div>
      {!following&&<button type="button" className="cognitive-follow-latest" onClick={followLatest}><ArrowDown size={13}/>Följ senaste arbetet</button>}
      <form onSubmit={event=>{event.preventDefault();void submit();}} className="cognitive-composer">
        <div className="cognitive-composer-inner">
          {currentMission&&<section className="cognitive-live-mission" data-mission-id={currentMission.id}>
            <div className="cognitive-live-mission-heading"><span className={'cognitive-mission-dot '+(currentMission.status==='ACTIVE'?'active':'')}/><span>Pågående uppdrag</span>
              {onOpenWork&&<button type="button" onClick={onOpenWork}>Visa arbete<ChevronRight size={12}/></button>}
              {onCancelMission&&<button type="button" aria-label="Avsluta aktuellt uppdrag" disabled={closingMission===currentMission.id||Boolean(activeDetail.cancelRequested)} onClick={async()=>{
                setClosingMission(currentMission.id);setCloseError(null);
                try{await onCancelMission(currentMission.id);}catch(error:any){setCloseError(error.message);}finally{setClosingMission(null);}
              }}><Square size={11}/>{activeDetail.cancelRequested?'Avslut begärt':'Avsluta'}</button>}
            </div>
            <p title={currentMission.goal}>{currentMission.goal}</p>
            <div className="cognitive-live-mission-detail">{latestMissionObservation?.text || activeDetail.lastAction?.text || ({ACTIVE:'Väntar på nästa observation',BLOCKED:'Ett hinder behöver lösas',AWAITING_VERIFICATION:'Slutresultatet behöver verifieras'})[currentMission.status]}</div>
            {closeError&&<div role="alert" className="cognitive-error">{closeError}</div>}
          </section>}
          {currentMission&&<div className="cognitive-live-questions"><button type="button" onClick={()=>prompt('Vad har du upptäckt hittills i det aktuella uppdraget?')} disabled={Boolean(busy)}>Vad har du upptäckt?</button><button type="button" onClick={()=>prompt('Visa vad som faktiskt fungerar och vilka belägg som stöder det.')} disabled={Boolean(busy)}>Vad fungerar?</button></div>}

          {selectedTool && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-[#111820] border border-[#263544] text-xs flex items-center gap-2">
              <span className="text-slate-500">{selectedTool.kind === 'agent' ? 'Agent' : selectedTool.kind === 'skill' ? 'Skill' : 'MCP-verktyg'}</span>
              <span className="text-cyan-300 truncate">{selectedTool.label}</span>
              <button type="button" onClick={onClearSelectedTool} aria-label="Ta bort valt verktyg" className="ml-auto text-slate-500 hover:text-slate-200">×</button>
            </div>
          )}
          <div className="cognitive-input-box">
            <textarea
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              aria-label="Meddelande till JACO"
              placeholder={composeMode==='goal'?'Beskriv det JACO ska bygga eller lösa…':'Skriv till JACO. Du kan fråga medan arbetet pågår…'}
              className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] leading-6 text-slate-100 outline-none placeholder:text-slate-600"
            />
            {selectedTool && ['mcp','skill'].includes(selectedTool.kind) && (
              <div className="px-3 pb-2 flex items-center gap-2">
                <input
                  value={toolArguments}
                  onChange={event => setToolArguments(event.target.value)}
                  placeholder={selectedTool.kind === 'skill' ? 'Skill-argument som JSON, t.ex. {"input":"value"}' : 'MCP-argument som JSON, t.ex. {"surface":"DESKTOP"}'}
                  className="flex-1 bg-[#111820] border border-[#30363d] rounded px-2 py-1.5 text-xs font-mono text-slate-300 outline-none focus:border-cyan-800"
                />
                <button type="button" onClick={() => void runSelectedTool()} disabled={Boolean(busy)}
                  className="px-3 py-1.5 text-xs border border-violet-800 text-violet-300 rounded hover:bg-violet-950/30 disabled:opacity-40">
                  {busy === 'tool' ? 'Kör…' : selectedTool.kind === 'skill' ? 'Kör skill' : 'Kör MCP'}
                </button>
              </div>
            )}
            <div className="cognitive-input-actions">
              <div className="cognitive-compose-modes" role="group" aria-label="Typ av meddelande">
                <button type="button" aria-pressed={composeMode==='chat'} onClick={()=>setComposeMode('chat')}><MessageSquare size={12}/>Fråga</button>
                <button type="button" aria-pressed={composeMode==='goal'} onClick={()=>setComposeMode('goal')}><Target size={12}/>Uppdrag</button>
              </div>
              <span className="cognitive-enter-hint">Shift + Enter för ny rad</span>
              <button type="submit" aria-label={composeMode==='goal'?'Starta uppdrag':'Skicka meddelande'} title={composeMode==='goal'?'Starta uppdrag':'Skicka'} disabled={!input.trim()||Boolean(busy)||!storageReady} className="cognitive-send-button">{busy?<Loader2 size={16} className="animate-spin"/>:<ArrowUp size={18}/>}</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default AuraChatPanel;
