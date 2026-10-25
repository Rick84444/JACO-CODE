import { readAuraResponse as apiJson } from '../lib/auraApi.mjs';
import { AttachmentPicker } from './AttachmentPicker';
import { CopyMessageButton } from './CopyMessageButton';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Search as SearchIcon, Bot, ArrowUp, ArrowDown, Square, Send, Target, Loader2, FileCode2, Settings2, ArrowUpRight, MessageSquare, ChevronRight } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import { useUiLanguage } from '../i18n/UiLanguage';
import { JacoWordmark } from './JacoWordmark';
import { CognitiveEventCard } from './CognitiveEventCard';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { safeCognitiveText } from '../lib/cognitiveEvents.mjs';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
  attachments?:Array<{id:string;name:string;fileCount:number}>;
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
  const { tr } = useUiLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'system',
    content: tr('Fråga om arbetsytan eller skapa ett uppdrag. Anslutningsstatus avgörs när ett anrop görs.', 'Ask about the workspace or create a mission. Connection status is verified when a call is made.'),
  }]);
  const [input, setInput] = useState('');
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
  const appendMessage = async (message:ChatMessage) => {
    try {
      const data=await fetch('/api/aura/chat/session/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}).then(apiJson);
      setMessages(current=>current.some(m=>m.id===data.message.id)?current:[...current,data.message]);setStorageError(null);
    } catch(error:any) {
      // Keep the actual answer visible, but explicitly report that durable storage failed.
      setMessages(current=>[...current,{...message,at:new Date().toISOString()}]);setStorageError(`Meddelandet visas men kunde inte sparas: ${error.message}`);
      if (message.role === 'user') throw error;
      return null;
    }
  };
  return { messages, setMessages, appendMessage, storageReady, storageError, retryStorage, input, setInput, busy, setBusy, toolArguments, setToolArguments };
}

interface Props {
  session: ReturnType<typeof useAuraChatSession>;
  runControls?: React.ReactNode;
  onOpenProviders?: () => void;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  selectedTool?: AuraSelectedTool | null;
  onClearSelectedTool?: () => void;
  onStartGoal: (goal: string, selectedTool?: AuraSelectedTool | null, attachmentIds?: string[]) => Promise<any> | void;
  liveEvents?: CognitiveEvent[];
  liveConnection?: string;
  historyTruncated?: boolean;
  runtimeRunning?: boolean;
  runtimeError?: string|null;
  onOpenEvidence?: (event:CognitiveEvent)=>void;
  onOpenFile?: (path:string)=>void;
  activity?: AuraChatActivity[];
  missions?: Array<{id:string;goal:string;status:string;cancelRequested?:boolean}>;
}



// Like readAuraResponse, but keeps the server's plain-language hint on the error so the chat can show it.
async function chatJson(response: Response) {
  let data: any;
  try { data = await response.json(); } catch { throw new Error(`API_INVALID_JSON: HTTP_${response.status}`); }
  if (!response.ok || data?.success === false) throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : `HTTP_${response.status}`), { hint: data?.hint });
  return data;
}

export const AuraChatPanel: React.FC<Props> = ({ session, runControls, activeFilePath, activeFileContent, selectedTool, onClearSelectedTool, onStartGoal, onOpenProviders, activity = [], missions = [], liveEvents = [], liveConnection, historyTruncated = false, runtimeError, onOpenEvidence, onOpenFile }) => {
  const { messages, setMessages, appendMessage, storageReady, storageError, retryStorage, input, setInput, busy, setBusy, toolArguments, setToolArguments } = session;
  const { tr } = useUiLanguage();
  const [attachments, setAttachments] = useState<Array<{id:string;files:Array<{path:string;format:string}>}>>(()=>{
    try {const saved=JSON.parse(localStorage.getItem('jaco:aura:attachments:v1')||'[]');return Array.isArray(saved)?saved.filter(item=>typeof item?.id==='string'&&/^[a-f0-9-]{36}$/.test(item.id)&&Array.isArray(item.files)&&item.files.length<=200&&item.files.every((file:any)=>typeof file?.path==='string'&&['text','binary'].includes(file.format))).slice(0,16):[];}catch{return [];}
  });
  useEffect(()=>{try{localStorage.setItem('jaco:aura:attachments:v1',JSON.stringify(attachments));}catch{}},[attachments]);
  const [uploading,setUploading] = useState(false);
  const [chatModel, setChatModel] = useState('seer');
  const [configuredModel, setConfiguredModel] = useState('seer');
  const [modelOverride, setModelOverride] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('seer');
  const [customModel, setCustomModel] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; local: boolean; defaultModel: string; models: string[]; pricedModels: string[]; credentialReady: boolean; availability?:string }>>([]);
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
    const timer=window.setInterval(()=>{if(!document.hidden)again();},30000);
    return () => {window.removeEventListener('jaco:aura:provider-chosen', again);window.clearInterval(timer);};
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

  const scrollRef=useRef<HTMLDivElement>(null);
  const followRef=useRef(true);
  const [composeMode,setComposeMode]=useState<'chat'|'goal'>('goal');
  const requestRef = useRef<AbortController|null>(null);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    if (busy !== 'chat') { setWaitingSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const [following,setFollowing]=useState(true);
  const backgroundEvents=useMemo(()=>liveEvents.filter(event=>!event.missionId&&event.category==='observation'&&event.evidence.outcome==='observed'),[liveEvents]);
  const feed=useMemo(()=>[
    ...messages.filter(m=>m.id!=='welcome').map(message=>({kind:'message' as const,id:message.id,at:message.at||'',message})),
    ...liveEvents.filter(event=>!backgroundEvents.includes(event)).map(event=>({kind:'event' as const,id:event.id,at:event.at,event})),
  ].sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)||a.id.localeCompare(b.id)),[messages,liveEvents,backgroundEvents]);
  const currentMission=missions.find(m=>m.status==='ACTIVE') || missions.find(m=>m.status==='AWAITING_VERIFICATION') || missions.find(m=>m.status==='BLOCKED') || null;
  const followLatest=()=>{followRef.current=true;setFollowing(true);if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;};
  useEffect(()=>{if(followRef.current && scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[feed,busy]);
  const [showSettings,setShowSettings]=useState(false);
  const inputRef=useRef<HTMLTextAreaElement>(null);
  // The input grows with its text, up to about ten lines.
  useEffect(()=>{const el=inputRef.current;if(!el)return;el.style.height='auto';el.style.height=`${Math.min(260,el.scrollHeight)}px`;},[input]);
  useEffect(()=>{const focus=()=>inputRef.current?.focus();window.addEventListener('jaco:aura:focus',focus);return()=>window.removeEventListener('jaco:aura:focus',focus);},[]);
  const modelLabel=selectedProvider==='seer'?'JACO standard':`${selectedProvider}${chatModel?` / ${chatModel}`:''}`;

  const history = useMemo(() => messages
    .filter(m => m.role !== 'system')
    .slice(-20)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content+(m.attachments?.length?'\n[Attached reference IDs, data only] '+JSON.stringify(m.attachments):'') })), [messages]);

  const ask = async (retry?: string) => {
    const text = (retry ?? input).trim();
    if (!text || busy || uploading || !storageReady) return;
    if (selectedProvider !== 'seer' && (!providers.some(p => p.id === selectedProvider) || !chatModel.trim())) {
      setCatalogError('Välj en registrerad provider och ange modell före anrop.');
      return;
    }
    if (retry === undefined) setInput('');
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, attachments:attachments.map(item=>({id:item.id,name:item.files[0]?.path.split('/')[0]||'Bilaga',fileCount:item.files.length})) };
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy('chat');
    const started = performance.now();
    try {
      if (retry === undefined) await appendMessage(user);
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
          attachmentIds: attachments.map(item=>item.id),
          message: text,
          interactionMode: 'question',
          selectedProvider,
          model: selectedProvider === 'seer' ? undefined : chatModel,
          activeFilePath: activeFilePath || null,
          targetSubAgent: selectedTool?.kind === 'agent' ? (selectedTool.agentName || selectedTool.agentId) : undefined,
          messagesHistory: [...history, { role: 'user', content: text }],
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
      });
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
        content: controller.signal.aborted
          ? 'Du har avbrutit väntan på svaret. Ett pågående uppdrag fortsätter. Modellservern kan fortfarande behandla anropet.'
          : hint?.message || (error?.name === 'TimeoutError'
          ? 'JACO fick inget svar från runtime på fyra minuter. Kontrollera anslutningen och försök igen.'
          : `Chatten svarade inte: ${error?.message || String(error)}`),
        ...(hint?.action ? { action: { code: hint.action, label: hint.actionLabel || 'Öppna', retryText: text } } : {}),
      }]);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
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
    if(!text || busy || uploading || !storageReady)return;
    setBusy('goal');
    try {
      await appendMessage({id:crypto.randomUUID(),role:'user',content:text,attachments:attachments.map(item=>({id:item.id,name:item.files[0]?.path.split('/')[0]||'Bilaga',fileCount:item.files.length}))});
      const accepted=await onStartGoal(text,selectedTool,attachments.map(item=>item.id));
      if(!accepted?.goal?.id)throw new Error('Runtime bekräftade inte uppdragets ID.');
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdraget är registrerat. Planering och resultat visas här när runtime rapporterar dem.',meta:'Uppdrag: '+accepted.goal.id});
      setInput('');setAttachments([]);setComposeMode('chat');
    } catch(error:any) {
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdragets registrering kunde inte bekräftas: '+safeCognitiveText(error?.message || String(error))});
    } finally {setBusy(null);}
  };
  const submit=()=>composeMode==='goal'?goal():ask();
  const prompt=(text:string,mode:'chat'|'goal'='chat')=>{setInput(text);setComposeMode(mode);inputRef.current?.focus();};

  return (
    <div className="cognitive-chat h-full min-h-0 flex flex-col">
      <div className="cognitive-chat-heading">
        <span><span className="cognitive-jaco-mark"/>JACO <span className="cognitive-chat-subtitle">{tr('Samtal & skapande','Conversation & creation')}</span></span>
        <button type="button" onClick={()=>setShowSettings(v=>!v)} aria-expanded={showSettings} aria-label={tr('Chattinställningar','Chat settings')} title={tr('Modell och budget','Model and budget')}><Settings2 size={15}/><span>{modelLabel}</span></button>
      </div>

      {runControls && <div className="cognitive-run-controls">{runControls}</div>}

      {showSettings && (
        <div className="px-4 py-3 border-b border-[#1c2a36] bg-[#0e1720] space-y-2 text-xs max-h-[50%] overflow-auto">
          <label className="flex items-center gap-2 text-slate-400">{tr('Modell','Model')}
            <select aria-label="Aura provider" value={selectedProvider} onChange={event => {
              const next = event.target.value;
              const model = providers.find(p => p.id === next)?.defaultModel || '';
              setSelectedProvider(next); setChatModel(model); saveSelection(next, model);
            }} disabled={busy !== null || !storageReady}
              className="flex-1 min-w-0 bg-[#111820] border border-[#343b45] rounded px-2 py-1 text-xs text-slate-200">
              <option value="seer">{tr('JACO standard','JACO default')}</option>
              {selectedProvider !== 'seer' && !providers.some(p => p.id === selectedProvider) && <option value={selectedProvider}>{selectedProvider} · {tr('ej registrerad','not registered')}</option>}
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.id}{provider.availability==='ACTIVE'?' · responding':provider.availability==='NO_KEY'?' · no key':' · unavailable'}</option>)}
            </select>
          </label>
          {selectedProvider !== 'seer' && (() => {
            // A list to pick from (a datalist does not open on most phones); typing a name stays possible.
            const listed = providers.find(p => p.id === selectedProvider)?.models || [];
            const typed = customModel || listed.length === 0;
            const pick = (model: string) => { setChatModel(model); saveSelection(selectedProvider, model); };
            return typed
              ? <div className="flex gap-2">
                  <input aria-label={tr('Aura modell','Aura model')} value={chatModel} maxLength={128} disabled={busy !== null || !storageReady} onChange={e => pick(e.target.value)} placeholder={tr('Modellnamn','Model name')} className="flex-1 min-w-0 text-sm px-2 py-1.5 bg-[#111820] border border-[#343b45] rounded" />
                  {listed.length > 0 && <button type="button" className="text-[11px] text-cyan-400" onClick={() => { setCustomModel(false); if (!listed.includes(chatModel)) pick(listed[0]); }}>{tr('Välj ur lista','Choose from list')}</button>}
                </div>
              : <select aria-label="Aura modell" value={listed.includes(chatModel) ? chatModel : ''} disabled={busy !== null || !storageReady}
                  onChange={e => e.target.value === '__other' ? setCustomModel(true) : pick(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 bg-[#111820] border border-[#343b45] rounded text-slate-200">
                  {!listed.includes(chatModel) && <option value="">{chatModel || tr('Välj modell','Choose model')}</option>}
                  {listed.map(model => <option key={model} value={model}>{model}</option>)}
                  <option value="__other">{tr('Annan modell…','Other model…')}</option>
                </select>;
          })()}
          <div className="flex flex-wrap gap-3 text-[11px] text-cyan-400">
            <button disabled={busy !== null || !storageReady} onClick={() => setCatalogRevision(v => v + 1)}>{tr('Uppdatera providerlista','Refresh provider list')}</button>
            {onOpenProviders && <button onClick={onOpenProviders}>{tr('Hantera providers','Manage providers')}</button>}
            {modelOverride && <button type="button" disabled={busy !== null || !storageReady} onClick={() => {
              setSelectedProvider(configuredModel.startsWith('ollama:') ? 'ollama' : 'seer');
              setChatModel(configuredModel.startsWith('ollama:') ? configuredModel.slice(7) : '');
              setModelOverride(false);
              try { localStorage.removeItem(modelStorageKey); localStorage.removeItem(selectionKey); } catch {}
            }} title="Use the model configured in JACO">{tr('Standardmodell','Default model')}</button>}
          </div>
          {selectedProvider !== 'seer' && providers.find(p => p.id === selectedProvider) && !providers.find(p => p.id === selectedProvider)!.credentialReady && <p className="text-[11px] text-amber-300">{tr('Provider saknar konfigurerad credential.','Provider credentials are not configured.')}</p>}
        </div>
      )}
      {catalogError && <p role="alert" className="px-4 py-2 text-xs text-amber-300 border-b border-[#1c2a36]">{catalogError}</p>}
      {storageError && <div role="alert" className="px-4 py-2 text-xs text-amber-300">{storageError}{!storageReady&&<button type="button" className="ml-3 underline" onClick={retryStorage}>{tr('Försök läsa igen','Retry reading')}</button>}</div>}

      <div ref={scrollRef} onScroll={()=>{const el=scrollRef.current;if(el){const near=el.scrollHeight-el.scrollTop-el.clientHeight<80;followRef.current=near;setFollowing(near);}}} role="log" aria-live="polite" aria-relevant="additions" aria-label={tr('JACO-konversation','JACO conversation')} className="cognitive-chat-scroll">
        <div className="cognitive-feed">
          {!storageReady && !storageError && <p className="cognitive-muted">{tr('Läser din sparade konversation…','Loading your saved conversation…')}</p>}
          {backgroundEvents.length>0&&<details className="cognitive-background-events"><summary>{tr('Aktivitet i bakgrunden','Background activity')} ({backgroundEvents.length})</summary>{backgroundEvents.map(event=><CognitiveEventCard key={event.id} event={event} onInspect={onOpenEvidence} onOpenFile={onOpenFile}/>)}</details>}
          {historyTruncated&&<p className="cognitive-history-note">{tr('Det senaste arbetet visas. Äldre händelser finns kvar i uppdragshistoriken.','The latest work is shown. Older events remain in mission history.')}</p>}
          {storageReady&&feed.length===0&&<div className="cognitive-welcome">
            <JacoWordmark size="lg"/>
            <div className="cognitive-section-kicker">{tr('Din idé. Ett sammanhängande arbete.','Your idea. One continuous workflow.')}</div>
            <h1>{tr('Vad vill du skapa?','What would you like to build?')}</h1>
            <p>{tr('Beskriv det du vill få att fungera.','Describe what you want to make work.')}<br/>{tr('Följ arbetet, pröva resultatet och forma nästa steg tillsammans.','Follow the work, test the outcome, and shape the next step together.')}</p>
            <div className="cognitive-start-prompts">
              <button type="button" onClick={()=>prompt(tr('Undersök det öppna projektet. Förklara vad som fungerar och vilka fel du faktiskt kan verifiera.','Inspect the open project. Explain what works and which defects you can actually verify.'),'goal')}><SearchIcon/><span>{tr('Undersök mitt projekt','Inspect my project')}<small>{tr('Förstå koden och nästa steg','Understand the code and next steps')}</small></span><ArrowUpRight size={14}/></button>
              <button type="button" onClick={()=>prompt(tr('Hjälp mig förbättra en funktion i projektet. Börja med att kartlägga den relevanta koden.','Help improve one feature in this project. Start by mapping the relevant code.'),'goal')}><FileCode2 size={17}/><span>{tr('Utveckla vidare','Develop further')}<small>{tr('Bygg på det som redan finns','Build on what already exists')}</small></span><ArrowUpRight size={14}/></button>
            </div>
          </div>}
          {feed.map(item=>{
            if(item.kind==='event')return <CognitiveEventCard key={item.id} event={item.event} onInspect={onOpenEvidence} onOpenFile={onOpenFile}/>;
            const message=item.message;
            return message.role==='user'?<div key={item.id} className="cognitive-user-message"><div>{message.content}</div>{message.attachments?.map(item=><small key={item.id} className="block mt-2">{tr('Bifogat','Attached')}: {item.name} · {item.fileCount} {tr('filer','files')}</small>)}</div>
              :message.role==='assistant'?<article key={item.id} className="cognitive-assistant-message"><div className="cognitive-message-author"><span className="cognitive-jaco-mark"/>JACO</div><ChatMarkdown text={message.content}/><CopyMessageButton text={message.content}/>{message.meta&&<details className="cognitive-message-meta"><summary>{tr('Svar & källor','Answer & sources')}</summary><p>{message.meta}</p></details>}</article>
              :<div key={item.id} className="cognitive-system-message">{message.content}{message.action&&<button type="button" disabled={busy!==null} onClick={()=>void runAction(message.action!)}>{message.action.label}</button>}</div>;
          })}
          {busy&&<div className="cognitive-response-wait"><span role="status"><Loader2 size={15} className="animate-spin"/>{busy==='goal'?tr('Registrerar uppdraget…','Registering mission…'):busy==='tool'?tr('Väntar på verktygets resultat…','Waiting for tool result…'):tr('Väntar på modellens svar…','Waiting for model response…')}</span>{busy==='chat' && <><time aria-label={tr('Väntetid','Waiting time')}>{waitingSeconds} s</time><button type="button" onClick={() => requestRef.current?.abort()}>{tr('Avbryt svar','Cancel response')}</button></>}</div>}
        </div>
      </div>
      <form onSubmit={event=>{event.preventDefault();void submit();}} className="cognitive-composer">
        <div className="cognitive-composer-inner">
          {!following&&<button type="button" className="cognitive-follow-latest" onClick={followLatest}><ArrowDown size={13}/>{tr('Följ senaste arbetet','Follow latest work')}</button>}
          {currentMission&&<div className="cognitive-live-questions"><button type="button" onClick={()=>prompt(tr('Vad har du upptäckt hittills i det aktuella uppdraget?','What have you discovered so far in the current mission?'))} disabled={Boolean(busy)}>{tr('Vad har du upptäckt?','What have you found?')}</button><button type="button" onClick={()=>prompt(tr('Visa vad som faktiskt fungerar och vilka belägg som stöder det.','Show what actually works and the evidence supporting it.'))} disabled={Boolean(busy)}>{tr('Vad fungerar?','What works?')}</button></div>}

          {selectedTool && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-[#111820] border border-[#263544] text-xs flex items-center gap-2">
              <span className="text-slate-500">{selectedTool.kind === 'agent' ? 'Agent' : selectedTool.kind === 'skill' ? 'Skill' : tr('MCP-verktyg','MCP tool')}</span>
              <span className="text-cyan-300 truncate">{selectedTool.label}</span>
              <button type="button" onClick={onClearSelectedTool} aria-label={tr('Ta bort valt verktyg','Remove selected tool')} className="ml-auto text-slate-500 hover:text-slate-200">×</button>
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
              aria-label={tr('Meddelande till JACO','Message to JACO')}
              placeholder={composeMode==='goal'?tr('Beskriv det JACO ska bygga eller lösa…','Describe what JACO should build or solve…'):tr('Skriv till JACO. Du kan fråga medan arbetet pågår…','Message JACO. You can ask questions while work continues…')}
              className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] leading-6 text-slate-100 outline-none placeholder:text-slate-600"
            />
            {selectedTool && ['mcp','skill'].includes(selectedTool.kind) && (
              <div className="px-3 pb-2 flex items-center gap-2">
                <input
                  value={toolArguments}
                  onChange={event => setToolArguments(event.target.value)}
                  placeholder={selectedTool.kind === 'skill' ? tr('Skill-argument som JSON, t.ex. {"input":"value"}','Skill arguments as JSON, e.g. {"input":"value"}') : tr('MCP-argument som JSON, t.ex. {"surface":"DESKTOP"}','MCP arguments as JSON, e.g. {"surface":"DESKTOP"}')}
                  className="flex-1 bg-[#111820] border border-[#30363d] rounded px-2 py-1.5 text-xs font-mono text-slate-300 outline-none focus:border-cyan-800"
                />
                <button type="button" onClick={() => void runSelectedTool()} disabled={Boolean(busy)}
                  className="px-3 py-1.5 text-xs border border-violet-800 text-violet-300 rounded hover:bg-violet-950/30 disabled:opacity-40">
                  {busy === 'tool' ? tr('Kör…','Running…') : selectedTool.kind === 'skill' ? tr('Kör skill','Run skill') : tr('Kör MCP','Run MCP')}
                </button>
              </div>
            )}
            <div className="cognitive-input-actions">
              <div className="cognitive-compose-modes" role="group" aria-label={tr('Typ av meddelande','Message type')}>
                <button type="button" aria-pressed={composeMode==='goal'} onClick={()=>setComposeMode('goal')}><Target size={12}/>{tr('Uppdrag','Mission')}</button>
                <button type="button" aria-pressed={composeMode==='chat'} onClick={()=>setComposeMode('chat')}><MessageSquare size={12}/>{tr('Fråga','Ask')}</button>
              </div>
              <span className="cognitive-enter-hint">{tr('Shift + Enter för ny rad','Shift + Enter for new line')}</span>
              <button type="submit" aria-label={composeMode==='goal'?tr('Starta uppdrag','Start mission'):tr('Skicka meddelande','Send message')} title={composeMode==='goal'?tr('Starta uppdrag','Start mission'):tr('Skicka','Send')} disabled={!input.trim()||Boolean(busy)||uploading||!storageReady} className="cognitive-send-button">{busy?<Loader2 size={16} className="animate-spin"/>:<ArrowUp size={18}/>}</button>
            </div>
          </div>
          <AttachmentPicker items={attachments} onChange={setAttachments} onBusy={setUploading} disabled={Boolean(busy)}/>
          <p className="cognitive-composer-help">{composeMode === 'goal' ? tr('JACO arbetar inom uppdragets behörigheter. Beslut som kräver dig visas ovanför arbetet.','JACO works within mission permissions. Decisions requiring you appear above the work.') : tr('Fråga om arbetet utan att starta ett nytt uppdrag.','Ask about ongoing work without starting a new mission.')}</p>
        </div>
      </form>
    </div>
  );
};

export default AuraChatPanel;
