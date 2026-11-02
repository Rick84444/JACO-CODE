import { readAuraResponse as apiJson } from '../lib/auraApi.mjs';
import { AttachmentPicker } from './AttachmentPicker';
import { CopyMessageButton } from './CopyMessageButton';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Search as SearchIcon, Bot, ArrowUp, ArrowDown, Square, Send, Target, Loader2, FileCode2, Settings2, ArrowUpRight, MessageSquare, ChevronRight } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import { useUiLanguage } from '../i18n/UiLanguage';
import { JacoWordmark } from './JacoWordmark';
import { initialAuraRunMode } from '../lib/auraRunModes.mjs';
import { parseAuraMissionCommand } from '../lib/auraChatCommands.mjs';
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
  onStartGoal: (goal: string, selectedTool?: AuraSelectedTool | null, attachmentIds?: string[], executionMode?: 'autonomous') => Promise<any> | void;
  onCancelMission?: (id: string) => Promise<void>;
  onSteerMission?: (id: string, instruction: string, requestId: string) => Promise<{steering:{revision:number};missionId:string}>;
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

export const AuraChatPanel: React.FC<Props> = ({ session, runControls, activeFilePath, activeFileContent, selectedTool, onClearSelectedTool, onStartGoal, onCancelMission, onSteerMission, onOpenProviders, activity = [], missions = [], liveEvents = [], liveConnection, historyTruncated = false, runtimeError, onOpenEvidence, onOpenFile }) => {
  const { messages, setMessages, appendMessage, storageReady, storageError, retryStorage, input, setInput, busy, setBusy, toolArguments, setToolArguments } = session;
  const { tr } = useUiLanguage();
  const [attachments, setAttachments] = useState<Array<{id:string;files:Array<{path:string;format:string}>}>>(()=>{
    try {const saved=JSON.parse(localStorage.getItem('jaco:aura:attachments:v1')||'[]');return Array.isArray(saved)?saved.filter(item=>typeof item?.id==='string'&&/^[a-f0-9-]{36}$/.test(item.id)&&Array.isArray(item.files)&&item.files.length<=200&&item.files.every((file:any)=>typeof file?.path==='string'&&['text','binary'].includes(file.format))).slice(0,16):[];}catch{return [];}
  });
  useEffect(()=>{try{localStorage.setItem('jaco:aura:attachments:v1',JSON.stringify(attachments));}catch{}},[attachments]);
  const [uploading,setUploading] = useState(false);
  const [missionStopBusy,setMissionStopBusy] = useState<string|null>(null);
  const [missionStopNotice,setMissionStopNotice] = useState<string|null>(null);
  const [missionSteerBusy,setMissionSteerBusy] = useState(false);
  const [missionSteerNotice,setMissionSteerNotice] = useState<string|null>(null);
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
  // The selected mode changes dispatch, not privileges; only manual/planning survive reload.
  const [runMode,setRunMode]=useState<'manual'|'planning'|'autonomous'>(()=>{
    try { return initialAuraRunMode(localStorage.getItem('jaco:aura:run-mode:v1')); }
    catch { return 'manual'; }
  });
  const [showModePicker,setShowModePicker]=useState(false);
  const [showBuildAgent,setShowBuildAgent]=useState(false);
  const [agentDraft,setAgentDraft]=useState({name:'',title:'',task:'',goal:''});
  const [agentKey,setAgentKey]=useState('');
  const [agentCreating,setAgentCreating]=useState(false);
  const [agentMessage,setAgentMessage]=useState<string|null>(null);
  const [cognitiveSuggestions,setCognitiveSuggestions]=useState<{knowledge:number;skills:number}|null>(null);
  useEffect(()=>{
    const query=input.trim();
    if(query.length<8){setCognitiveSuggestions(null);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const args=new URLSearchParams({q:query.slice(0,360)});
      fetch('/api/aura/chat/cognitive-activation?'+args,{signal:controller.signal,cache:'no-store'})
        .then(r=>r.ok?r.json():null)
        .then(data=>{
          if(controller.signal.aborted)return;
          const active=data?.activation;
          setCognitiveSuggestions(active&&Array.isArray(active.knowledge)&&Array.isArray(active.skills)
            ? {knowledge:active.knowledge.length,skills:active.skills.length}:null);
        }).catch(()=>{if(!controller.signal.aborted)setCognitiveSuggestions(null);});
    },400);
    return ()=>{controller.abort();window.clearTimeout(timer);};
  },[input]);
  const buildAgent = async () => {
    if (agentCreating || !agentDraft.name.trim() || !agentKey.trim()) return;
    setAgentCreating(true); setAgentMessage(null);
    try {
      const response=await fetch('/api/aura/organization/agents',{
        method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'application/json','x-jaco-operator-token':agentKey},
        body:JSON.stringify({
          name:agentDraft.name.trim(),title:agentDraft.title.trim(),
          task:agentDraft.task.trim(),goal:agentDraft.goal.trim(),
          reportsTo:'aura',model:{kind:'local',providerId:'ollama',model:''},
        }),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.success===false||!data.agent?.id)throw new Error(data.error||'AGENT_CREATE_NOT_CONFIRMED');
      setAgentMessage(tr('Agent registrerad utan verktygsbehörigheter: ','Agent registered without tool permissions: ')+data.agent.id);
      setAgentDraft({name:'',title:'',task:'',goal:''});setAgentKey('');
    }catch(error:any){
      setAgentMessage(tr('Kunde inte skapa agent: ','Could not create agent: ')+String(error?.message||error).slice(0,200));
    }finally{setAgentCreating(false);}
  };
  const selectRunMode = (next:'manual'|'planning'|'autonomous') => {
    if (busy) return;
    setRunMode(next);
    setShowModePicker(false);
    try { localStorage.setItem('jaco:aura:run-mode:v1', next === 'autonomous' ? 'manual' : next); } catch {}
  };
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

  const [chatControlBusy,setChatControlBusy]=useState(false);
  // This command lane is independent of a pending chat inference. A stop/steer
  // request never cancels the chat HTTP request or the mission's in-flight tool.
  const executeChatMissionCommand = async (text:string,controlCommand:ReturnType<typeof parseAuraMissionCommand>,retry?:string) => {
    if (!controlCommand || chatControlBusy || uploading || !storageReady) return;
    if (retry === undefined) setInput('');
    setChatControlBusy(true);
    try {
      if (retry === undefined) await appendMessage({id:crypto.randomUUID(),role:'user',content:text});
        const candidates=missions.filter(m=>['ACTIVE','AWAITING_VERIFICATION','BLOCKED'].includes(m.status) && !m.cancelRequested);
        const active=candidates.length===1 ? candidates[0] : null;
        if (!active) {
          await appendMessage({id:crypto.randomUUID(),role:'system',
            content:candidates.length>1
              ? tr('Flera uppdrag är aktiva. Välj uppdraget i arbetsytan innan du stoppar eller ändrar det.','Multiple missions are active. Select the mission before stopping or steering it.')
              : tr('Inget aktivt uppdrag hittades att ändra eller stoppa.','No active mission was found to change or stop.')});
          return;
        }
        if (attachments.length) {
          await appendMessage({id:crypto.randomUUID(),role:'system',
            content:tr('Kontrollkommandon kan inte skickas med bilagor.','Mission control commands cannot contain attachments.')});
          return;
        }
        try {
          if (controlCommand.kind==='stop') {
            if (!onCancelMission) throw new Error('MISSION_STOP_NOT_AVAILABLE');
            await onCancelMission(active.id);
            await appendMessage({id:crypto.randomUUID(),role:'system',
              content:tr('Stopp begärt. Pågående steg kan fortfarande avslutas; kontrollera uppdragets slutstatus.','Stop requested. An in-flight step may still finish; check the mission final status.'),
              meta:'Mission '+active.id+' · cancellation requested'});
          } else {
            if (!onSteerMission || active.status!=='ACTIVE') throw new Error('MISSION_STEER_NOT_AVAILABLE');
            const updated=await onSteerMission(active.id,controlCommand.instruction,crypto.randomUUID());
            await appendMessage({id:crypto.randomUUID(),role:'system',
              content:tr('Instruktionen är sparad för nästa planeringsgräns; pågående verktyg avbryts inte.','Direction saved for the next planning boundary; in-flight tools are not interrupted.'),
              meta:'Mission '+active.id+' · steer revision '+updated.steering.revision});
          }
        } catch (error:any) {
          await appendMessage({id:crypto.randomUUID(),role:'system',
            content:tr('Uppdragskontrollen misslyckades: ','Mission control failed: ')+safeCognitiveText(error?.message || String(error))});
        }
        return;
    } catch (error:any) {
      setMessages(current=>[...current,{id:crypto.randomUUID(),role:'system',
        content:tr('Kunde inte skicka kommandot: ','Could not send the command: ')+safeCognitiveText(error?.message || String(error))}]);
    } finally {
      setChatControlBusy(false);
    }
  };

  const ask = async (retry?: string) => {
    const text = (retry ?? input).trim();
    if (!text || uploading || !storageReady) return;
    const controlCommand=parseAuraMissionCommand(text);
    if (controlCommand) { await executeChatMissionCommand(text,controlCommand,retry); return; }
    if (busy) return;
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
          interactionMode: runMode === 'planning' ? 'planning' : 'question',
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
          data.cognitiveActivation?.knowledgeCount ? `knowledge: ${data.cognitiveActivation.knowledgeCount} verified` : null,
          data.cognitiveActivation?.activeSkillCandidates ? `skill candidates: ${data.cognitiveActivation.activeSkillCandidates} (not granted)` : null,
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

  // Send to the durable execution ledger, not to a second LLM and not as a new goal.
  const steerCurrentMission = async (id: string) => {
    const instruction = input.trim();
    if (!onSteerMission || !instruction || missionSteerBusy || !storageReady || uploading || attachments.length) return;
    setMissionSteerBusy(true);
    setMissionSteerNotice(null);
    try {
      const result = await onSteerMission(id, instruction, crypto.randomUUID());
      setInput(previous => previous.trim() === instruction ? '' : previous);
      setMissionSteerNotice(tr('Ändringen sparades för nästa planeringssteg. Pågående verktyg avbryts inte.', 'Direction saved for the next planning step. Running tools are not interrupted.'));
      try {
        await appendMessage({ id: crypto.randomUUID(), role: 'user', content: instruction, meta: `Steer · mission ${id} · revision ${result.steering.revision}` });
      } catch {
        setMissionSteerNotice(tr('Ändringen sparades men chatthistoriken kunde inte uppdateras.', 'Direction was saved but chat history could not be updated.'));
      }
    } catch (error: any) {
      setMissionSteerNotice(tr('Ändringen sparades inte: ', 'Direction was not saved: ') + safeCognitiveText(error?.message || String(error)));
    } finally {
      setMissionSteerBusy(false);
    }
  };

  // Mission stop is distinct from aborting an HTTP chat response.
  // The canonical runtime owns cancellation, graph propagation and receipts.
  const stopCurrentMission = async (id: string) => {
    if (!onCancelMission || missionStopBusy) return;
    setMissionStopBusy(id);
    setMissionStopNotice(null);
    try {
      await onCancelMission(id);
      setMissionStopNotice(tr('Stopp begärt. Kontrollera slutstatus i uppdraget.', 'Stop requested. Check the mission for its final status.'));
    } catch (error: any) {
      setMissionStopNotice(tr('Stopp kunde inte begäras: ', 'Could not request stop: ') + safeCognitiveText(error?.message || String(error)));
    } finally {
      setMissionStopBusy(null);
    }
  };

  const goal = async () => {
    const text=input.trim();
    if(!text || busy || uploading || !storageReady)return;
    setBusy('goal');
    try {
      await appendMessage({id:crypto.randomUUID(),role:'user',content:text,attachments:attachments.map(item=>({id:item.id,name:item.files[0]?.path.split('/')[0]||'Bilaga',fileCount:item.files.length}))});
      const accepted=await onStartGoal(text,selectedTool,attachments.map(item=>item.id),'autonomous');
      if(!accepted?.goal?.id)throw new Error('Runtime bekräftade inte uppdragets ID.');
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdraget är registrerat. Planering och resultat visas här när runtime rapporterar dem.',meta:'Uppdrag: '+accepted.goal.id});
      setInput('');setAttachments([]); // Mode is retained; chat is still available while the mission runs.
    } catch(error:any) {
      await appendMessage({id:crypto.randomUUID(),role:'system',content:'Uppdragets registrering kunde inte bekräftas: '+safeCognitiveText(error?.message || String(error))});
    } finally {setBusy(null);}
  };
  const submit=()=>{
    // Build Agent is a local UI action in every mode, never a model directive or a mission.
    if(/^\/?build agent$/i.test(input.trim())) {
      setShowBuildAgent(true);setShowModePicker(false);setInput('');
      return;
    }
    return ask(); // Every mode retains normal conversation; mission start is explicit.
  };
  const prompt=(text:string,mode:'chat'|'goal'='chat')=>{
    setInput(text);
    // Suggested tasks open in read-only planning first; the operator selects Full Autonomous.
    setRunMode(mode==='goal'?'planning':'manual');
    inputRef.current?.focus();
  };

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
          {currentMission && onCancelMission && !currentMission.cancelRequested && <button type="button" disabled={Boolean(missionStopBusy)} onClick={()=>void stopCurrentMission(currentMission.id)} className="mx-2 mb-2 rounded border border-rose-900 px-3 py-1.5 text-xs text-rose-200 disabled:opacity-50" aria-label={tr('Stoppa pågående uppdrag','Stop current mission')}>{missionStopBusy ? tr('Begär stopp…','Requesting stop…') : tr('Stoppa uppdrag','Stop mission')}</button>}
          {missionStopNotice&&<p role="status" className="mx-3 mb-2 text-xs text-slate-300">{missionStopNotice}</p>}
          {missionSteerNotice&&<p role="status" className="mx-3 mb-2 text-xs text-slate-300">{missionSteerNotice}</p>}

          {selectedTool && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-[#111820] border border-[#263544] text-xs flex items-center gap-2">
              <span className="text-slate-500">{selectedTool.kind === 'agent' ? 'Agent' : selectedTool.kind === 'skill' ? 'Skill' : tr('MCP-verktyg','MCP tool')}</span>
              <span className="text-cyan-300 truncate">{selectedTool.label}</span>
              <button type="button" onClick={onClearSelectedTool} aria-label={tr('Ta bort valt verktyg','Remove selected tool')} className="ml-auto text-slate-500 hover:text-slate-200">×</button>
            </div>
          )}
          {showModePicker && (
            <section role="dialog" aria-label={tr('Välj agentläge','Choose agent mode')}
              className="mb-2 rounded-lg border border-cyan-900/60 bg-[#101923] p-3 space-y-2" data-testid="jaco-run-mode-panel">
              <div className="text-xs font-semibold text-cyan-200">{tr('Välj hur JACO arbetar','Choose how JACO works')}</div>
              <div role="group" aria-label={tr('Körläge','Execution mode')} className="grid gap-2">
                {([
                  ['manual', 'Manual', tr('Samtal och läsverktyg. Inga nya uppdrag eller ändringar.','Conversation and read tools only. No new missions or changes.')],
                  ['planning', 'Planning', tr('Analysera, jämför och skapa en plan. Endast läsverktyg, inga policyändringar.','Research, compare and propose a plan. Read tools only; no policy changes.')],
                  ['autonomous', 'Full Autonomous', tr('Starta ett varaktigt Aura-uppdrag. Befintliga mandat, budget och godkännanden gäller.','Start a durable Aura mission. Existing permissions, budgets and approvals still apply.')],
                ] as const).map(([value,label,help])=>(
                  <button type="button" key={value} aria-pressed={runMode===value}
                    onClick={()=>selectRunMode(value)} disabled={Boolean(busy)}
                    className={`flex flex-col items-start rounded border px-3 py-2 text-left text-xs ${runMode===value?'border-cyan-500 bg-cyan-950/30 text-cyan-100':'border-slate-700 text-slate-200 hover:border-slate-500'}`}>
                    <span className="font-semibold">{label}</span>
                    <span className="mt-1 text-slate-400">{help}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">{tr('Detta är ett arbetsläge, inte en behörighetsökning.','This selects a workflow, not additional privileges.')}</p>
              <button type="button" onClick={()=>setShowModePicker(false)} className="text-xs text-slate-400 hover:text-white">{tr('Stäng','Close')}</button>
            </section>
          )}
          {showBuildAgent && (
            <section data-testid="jaco-build-agent-panel" aria-label="Build Agent"
              className="mb-2 rounded-lg border border-slate-700 bg-[#101923] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-200">Build Agent</span>
                <button type="button" onClick={()=>setShowBuildAgent(false)} aria-label={tr('Stäng agentbyggaren','Close agent builder')} className="text-slate-400">×</button>
              </div>
              <p className="text-slate-400">{tr(
                'Skapar en agent under Aura utan verktygsbehörigheter eller budget. Ingen agentprocess startas.',
                'Registers an agent under Aura with zero tool permissions and budget. No worker starts.'
              )}</p>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Agent name" placeholder="Agent name" maxLength={60} value={agentDraft.name}
                  onChange={e=>setAgentDraft(x=>({...x,name:e.target.value}))} className="rounded bg-[#0c141d] border border-slate-700 p-2"/>
                <input aria-label="Agent role" placeholder="Role" maxLength={60} value={agentDraft.title}
                  onChange={e=>setAgentDraft(x=>({...x,title:e.target.value}))} className="rounded bg-[#0c141d] border border-slate-700 p-2"/>
              </div>
              <input aria-label="Agent task" placeholder="Task / area of responsibility" maxLength={2000} value={agentDraft.task}
                onChange={e=>setAgentDraft(x=>({...x,task:e.target.value}))} className="w-full rounded bg-[#0c141d] border border-slate-700 p-2"/>
              <input aria-label="Agent goal" placeholder="Success criteria" maxLength={2000} value={agentDraft.goal}
                onChange={e=>setAgentDraft(x=>({...x,goal:e.target.value}))} className="w-full rounded bg-[#0c141d] border border-slate-700 p-2"/>
              <input aria-label="Organization operator credential" type="password" autoComplete="off"
                placeholder="JACO_ORG_OPERATOR_TOKEN (session only)" value={agentKey}
                onChange={e=>setAgentKey(e.target.value)} className="w-full rounded bg-[#0c141d] border border-slate-700 p-2"/>
              {agentMessage && <p role="status" className="text-slate-300">{agentMessage}</p>}
              <button data-testid="jaco-build-agent-submit" type="button" onClick={()=>void buildAgent()}
                disabled={agentCreating||!agentDraft.name.trim()||!agentKey.trim()}
                className="border border-cyan-800 rounded px-3 py-1.5 text-cyan-200 disabled:opacity-40">
                {agentCreating?tr('Skapar…','Creating…'):tr('Registrera agent','Register agent')}
              </button>
            </section>
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
              placeholder={tr('Skriv till JACO. Du kan fråga medan arbetet pågår…','Message JACO. You can ask questions while work continues…')}
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
              <div className="cognitive-compose-modes" role="group" aria-label={tr('Agentens körläge','Agent execution mode')}>
                <button type="button" data-testid="jaco-run-mode-toggle" aria-haspopup="dialog" aria-expanded={showModePicker}
                  data-run-mode={runMode}
                  className={runMode==='autonomous'?'jaco-autonomous-active':''}
                  onClick={()=>{setShowBuildAgent(false);setShowModePicker(value=>!value);}} disabled={Boolean(busy)}>
                  <Target size={12}/>
                  {runMode==='manual' ? 'Manual' : runMode==='planning' ? 'Planning' : 'Full Autonomous'}
                  <ChevronRight size={12}/>
                </button>
              </div>
              {currentMission?.status==='ACTIVE' && !currentMission.cancelRequested && onSteerMission && (
                <button data-testid="jaco-steer-mission" type="button" onClick={()=>void steerCurrentMission(currentMission.id)}
                  disabled={!input.trim() || Boolean(missionSteerBusy) || !storageReady || uploading || attachments.length > 0}
                  title={tr('Ändra nästa arbetssteg inom uppdragets befintliga behörigheter och kontrakt','Change the next work step within existing mission permissions and contract')}
                  className="text-[11px] text-cyan-300 hover:text-cyan-100 disabled:opacity-40">
                  {missionSteerBusy ? tr('Sparar ändring…','Saving direction…') : tr('Ändra uppdrag','Steer mission')}
                </button>
              )}
              <button data-testid="jaco-build-agent-toggle" type="button"
                className="text-[11px] text-slate-400 hover:text-cyan-300"
                aria-expanded={showBuildAgent} onClick={()=>{setShowModePicker(false);setShowBuildAgent(v=>!v);}}>
                <Bot size={12} className="inline mr-1"/>Build Agent
              </button>
              <span className="cognitive-enter-hint">{tr('Shift + Enter för ny rad','Shift + Enter for new line')}</span>
              {runMode==='autonomous' && <button data-testid="jaco-start-mission" type="button" onClick={()=>void goal()}
                disabled={!input.trim()||Boolean(busy)||uploading||!storageReady}
                title={tr('Starta ett nytt uppdrag med befintliga behörigheter','Start a new mission within existing permissions')}
                className="rounded border border-cyan-700 px-2 py-1.5 text-xs text-cyan-200 disabled:opacity-40">
                {tr('Starta uppdrag','Start mission')}
              </button>}
              <button data-testid="jaco-chat-send" type="submit" aria-label={tr('Skicka meddelande','Send message')} title={tr('Skicka','Send')} disabled={!input.trim()||(Boolean(busy)&&!parseAuraMissionCommand(input))||chatControlBusy||uploading||!storageReady} className="cognitive-send-button">{busy?<Loader2 size={16} className="animate-spin"/>:<ArrowUp size={18}/>}</button>
            </div>
          </div>
          <AttachmentPicker items={attachments} onChange={setAttachments} onBusy={setUploading} disabled={Boolean(busy)}/>
          {cognitiveSuggestions && (cognitiveSuggestions.knowledge>0||cognitiveSuggestions.skills>0) &&
            <p data-testid="jaco-cognitive-suggestions" className="text-[10px] text-slate-500 px-1">
              {tr('Verifierad kunskap','Verified knowledge')}: {cognitiveSuggestions.knowledge} ·
              {tr(' Föreslagna skills',' Skill candidates')}: {cognitiveSuggestions.skills}
              <span title={tr('Ett skillförslag ger inte verktygsbehörighet. Varje steg kontrolleras av runtimen.','Skill discovery grants no tool permissions. Each step must pass runtime checks.')}> · <span className="text-cyan-700">◇</span></span>
            </p>}
          <p className="cognitive-composer-help">{runMode==='autonomous' ? tr('Chatten fortsätter som vanligt. Starta uppdrag separat; stoppa eller ändra pågående uppdrag med kontrollerna ovan.','Conversation remains available. Start a mission separately; use the controls above to stop or steer running work.')
            : runMode==='planning' ? tr('Planning läser och föreslår. Inga verktygsändringar eller uppdrag startas.','Planning observes and proposes; no tool mutations or missions start.')
            : tr('Manual svarar med läsverktyg utan att starta ett uppdrag.','Manual answers using read tools without starting a mission.')}</p>
        </div>
      </form>
    </div>
  );
};

export default AuraChatPanel;
