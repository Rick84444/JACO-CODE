import React, { useState, useEffect } from 'react';
import { 
  CheckSquare, Pin, Archive, Trash2, Plus, Search, Tag, Sparkles, 
  RotateCcw, Lock, CheckCircle2, RefreshCw, Layers, Edit3, X,
  FileText, ExternalLink, ShieldCheck, LogOut, User as UserIcon
} from 'lucide-react';
import { KeepNote, KeepNoteItem, GoogleKeepUser } from '../types';
import { 
  initKeepAuth, signInWithGoogleKeep, logoutGoogleKeep, 
  fetchGoogleTasksNotes, getKeepAccessToken 
} from '../lib/googleKeepAuth';
import { User } from 'firebase/auth';

interface GoogleKeepManagerProps {
  onSendToAura?: (prompt: string) => void;
}

export const GoogleKeepManager: React.FC<GoogleKeepManagerProps> = ({ onSendToAura }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // Notes state
  const [notes, setNotes] = useState<KeepNote[]>([
    {
      id: 'keep-1',
      title: 'Aura Sovereign & JACO System Mål',
      textContent: '1. LNbits L402 uppgradering genomförd.\n2. Gold-Resonance cykel aktiv med 60 minuters intervall.\n3. Termux sensorövervakning aktiverad via Mission Gate.',
      color: 'yellow',
      isPinned: true,
      tags: ['System', 'JACO', 'Aura'],
      createdAt: '11:45',
      updatedAt: '12:10'
    },
    {
      id: 'keep-2',
      title: 'Checklista: NPU & Agent Redigering',
      listItems: [
        { id: 'li-1', text: 'Konfigurera Google Keep API & Tasks OAuth', checked: true },
        { id: 'li-2', text: 'Verifiera 3000 token gräns i server.ts', checked: true },
        { id: 'li-3', text: 'Synka anteckningar med Agent Aura minnesbank', checked: false }
      ],
      color: 'blue',
      isPinned: true,
      tags: ['Kod', 'Checklista'],
      createdAt: '10:30',
      updatedAt: '12:20'
    },
    {
      id: 'keep-3',
      title: 'Idéer för Kvantum-Simulering & CUDA',
      textContent: 'Utforska matrisberäkningar för zero-copy tensorer på Android NPU. Binda skript mot Ollama / Gemini 3.6 Flash.',
      color: 'purple',
      isPinned: false,
      tags: ['CUDA', 'NPU'],
      createdAt: '09:15',
      updatedAt: '09:15'
    }
  ]);

  // Form & view state
  const [activeTab, setActiveTab] = useState<'notes' | 'pinned' | 'checklists' | 'archived' | 'trash'>('notes');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newChecklistItems, setNewChecklistItems] = useState<KeepNoteItem[]>([]);
  const [newColor, setNewColor] = useState<KeepNote['color']>('yellow');
  const [newTag, setNewTag] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [isListMode, setIsListMode] = useState(false);

  // Edit Modal State
  const [editingNote, setEditingNote] = useState<KeepNote | null>(null);

  // Delete confirmation dialog state
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initKeepAuth(
      (user, token) => {
        setCurrentUser(user);
        if (token) {
          setAccessToken(token);
          handleSyncGoogleKeep(token);
        }
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setSyncStatusMsg(null);
    try {
      const res = await signInWithGoogleKeep();
      if (res?.user) {
        setCurrentUser(res.user);
        if (res.accessToken) {
          setAccessToken(res.accessToken);
          handleSyncGoogleKeep(res.accessToken);
        }
      }
    } catch (err: any) {
      setSyncStatusMsg('Inloggningsfel: ' + (err.message || 'Kunde inte ansluta till Google.'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    await logoutGoogleKeep();
    setCurrentUser(null);
    setAccessToken(null);
    setSyncStatusMsg('Utloggad från Google Keep.');
  };

  const handleSyncGoogleKeep = async (token?: string) => {
    const activeToken = token || accessToken || getKeepAccessToken();
    if (!activeToken) {
      setSyncStatusMsg('Vänligen logga in med Google för att synka dina Keep-anteckningar.');
      return;
    }

    setIsSyncing(true);
    setSyncStatusMsg('Synkar anteckningar med Google Workspace API...');
    try {
      const fetchedNotes = await fetchGoogleTasksNotes(activeToken);
      if (fetchedNotes.length > 0) {
        setNotes(prev => {
          const merged = [...prev];
          for (const fn of fetchedNotes) {
            if (fn.id && !merged.some(m => m.id === fn.id)) {
              merged.unshift(fn as KeepNote);
            }
          }
          return merged;
        });
        setSyncStatusMsg(`Synkning klar! Hämtade ${fetchedNotes.length} listor/anteckningar från Google Workspace.`);
      } else {
        setSyncStatusMsg('Google Keep/Tasks synkning slutförd.');
      }
    } catch {
      setSyncStatusMsg('Synkningen avslutades med lokalt läge.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistText.trim()) return;
    setNewChecklistItems(prev => [
      ...prev,
      { id: `item-${Date.now()}`, text: newChecklistText.trim(), checked: false }
    ]);
    setNewChecklistText('');
  };

  const handleAddTag = () => {
    if (!newTag.trim() || newTags.includes(newTag.trim())) return;
    setNewTags(prev => [...prev, newTag.trim()]);
    setNewTag('');
  };

  const handleCreateNote = () => {
    if (!newTitle.trim() && !newText.trim() && newChecklistItems.length === 0) return;

    const note: KeepNote = {
      id: `keep-${Date.now()}`,
      title: newTitle.trim() || 'Namnlös anteckning',
      textContent: isListMode ? undefined : newText.trim(),
      listItems: isListMode ? newChecklistItems : undefined,
      color: newColor,
      isPinned: activeTab === 'pinned',
      tags: newTags,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setNotes(prev => [note, ...prev]);

    // Reset form
    setNewTitle('');
    setNewText('');
    setNewChecklistItems([]);
    setNewTags([]);
    setIsCreating(false);
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotes(prev => prev.map(n => n.id === id ? { ...n, isPinned: !n.isPinned } : n));
  };

  const handleToggleArchive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotes(prev => prev.map(n => n.id === id ? { ...n, isArchived: !n.isArchived } : n));
  };

  const handleDeletePrompt = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteNoteId(id);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteNoteId) return;
    setNotes(prev => prev.map(n => n.id === confirmDeleteNoteId ? { ...n, isTrashed: true } : n));
    setConfirmDeleteNoteId(null);
  };

  const handlePermanentDelete = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleToggleCheckItem = (noteId: string, itemId: string) => {
    setNotes(prev => prev.map(n => {
      if (n.id === noteId && n.listItems) {
        return {
          ...n,
          listItems: n.listItems.map(item => item.id === itemId ? { ...item, checked: !item.checked } : item)
        };
      }
      return n;
    }));
  };

  const handleAskAuraAboutNote = (note: KeepNote, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSendToAura) {
      const summary = note.listItems 
        ? note.listItems.map(i => `[${i.checked ? 'x' : ' '}] ${i.text}`).join('\n')
        : note.textContent;
      onSendToAura(`Analysera denna Google Keep-anteckning "${note.title}":\n\n${summary}`);
    }
  };

  const filteredNotes = notes.filter(n => {
    const matchesSearch = 
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (n.textContent && n.textContent.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (n.tags && n.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())));

    if (!matchesSearch) return false;

    if (activeTab === 'pinned') return n.isPinned && !n.isTrashed && !n.isArchived;
    if (activeTab === 'checklists') return n.listItems && n.listItems.length > 0 && !n.isTrashed && !n.isArchived;
    if (activeTab === 'archived') return n.isArchived && !n.isTrashed;
    if (activeTab === 'trash') return n.isTrashed;
    return !n.isTrashed && !n.isArchived;
  });

  const getColorBg = (color?: KeepNote['color']) => {
    switch (color) {
      case 'yellow': return 'bg-amber-950/40 border-amber-800/50 text-amber-100';
      case 'green': return 'bg-cyan-950/40 border-emerald-800/50 text-emerald-100';
      case 'blue': return 'bg-sky-950/40 border-sky-800/50 text-sky-100';
      case 'purple': return 'bg-purple-950/40 border-purple-800/50 text-purple-100';
      case 'pink': return 'bg-pink-950/40 border-pink-800/50 text-pink-100';
      case 'dark': return 'bg-slate-950 border-slate-800 text-slate-100';
      default: return 'bg-slate-900 border-slate-800 text-slate-100';
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4 font-mono text-xs">
      {/* Top Banner & OAuth Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100">Google Keep & Anteckningshanterare</h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                Workspace API
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Skapa minnesanteckningar, checklistor & synka med Google Account
            </p>
          </div>
        </div>

        {/* Auth / Profile Area */}
        <div className="flex items-center gap-3 flex-wrap">
          {currentUser ? (
            <div className="flex items-center gap-3 bg-slate-950 p-2 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="User" className="w-7 h-7 rounded-full border border-amber-500/40" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold">
                    <UserIcon className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-bold text-slate-200">{currentUser.displayName || 'Google-användare'}</div>
                  <div className="text-[9px] text-slate-400">{currentUser.email}</div>
                </div>
              </div>

              <button
                onClick={() => handleSyncGoogleKeep()}
                disabled={isSyncing}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 rounded border border-slate-700 transition-colors"
                title="Synka nu"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={handleSignOut}
                className="p-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 rounded border border-rose-800/60 transition-colors"
                title="Logga ut"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              disabled={isAuthenticating}
              className="gsi-material-button bg-white hover:bg-slate-100 text-slate-900 px-3 py-2 rounded font-semibold flex items-center gap-2 shadow transition-all border border-slate-300"
            >
              <svg className="w-4 h-4" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span>{isAuthenticating ? 'Ansluter...' : 'Logga in med Google'}</span>
            </button>
          )}
        </div>
      </div>

      {syncStatusMsg && (
        <div className="bg-amber-950/30 border border-amber-800/40 p-2.5 rounded text-amber-200 text-[11px] flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            {syncStatusMsg}
          </span>
          <button onClick={() => setSyncStatusMsg(null)} className="text-amber-400 hover:text-amber-200">✕</button>
        </div>
      )}

      {/* Note Creation Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 transition-all">
        {!isCreating ? (
          <div 
            onClick={() => setIsCreating(true)}
            className="flex items-center justify-between cursor-pointer text-slate-400 hover:text-slate-200 p-2 bg-slate-950 rounded border border-slate-800"
          >
            <span className="font-semibold text-slate-300">Anteckna något...</span>
            <div className="flex items-center gap-2">
              <button 
                onClick={(e) => { e.stopPropagation(); setIsCreating(true); setIsListMode(true); }}
                className="p-1.5 hover:bg-slate-800 rounded text-amber-400"
                title="Ny checklista"
              >
                <CheckSquare className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <input
                type="text"
                placeholder="Titel"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-amber-500"
              />
              <button 
                onClick={() => setIsListMode(!isListMode)}
                className={`ml-2 px-2.5 py-1.5 rounded text-[10px] font-bold border ${
                  isListMode ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {isListMode ? 'Checklista' : 'Text'}
              </button>
            </div>

            {!isListMode ? (
              <textarea
                placeholder="Anteckna något..."
                rows={3}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-slate-200 focus:outline-none focus:border-amber-500 resize-none"
              />
            ) : (
              <div className="space-y-2 bg-slate-950 p-3 rounded border border-slate-800">
                <div className="space-y-1">
                  {newChecklistItems.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        checked={item.checked} 
                        onChange={() => {
                          setNewChecklistItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i));
                        }}
                        className="accent-amber-500"
                      />
                      <span className={`text-slate-200 ${item.checked ? 'line-through text-slate-500' : ''}`}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="+ Ny punkt..."
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem(); } }}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                  />
                  <button 
                    onClick={handleAddChecklistItem}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-slate-900 font-bold rounded"
                  >
                    Lägg till
                  </button>
                </div>
              </div>
            )}

            {/* Colors & Tag Pickers */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400">Färg:</span>
                {(['yellow', 'green', 'blue', 'purple', 'pink', 'dark'] as const).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-4 h-4 rounded-full border ${
                      newColor === c ? 'ring-2 ring-amber-400 scale-110' : ''
                    } ${
                      c === 'yellow' ? 'bg-amber-500' :
                      c === 'green' ? 'bg-emerald-500' :
                      c === 'blue' ? 'bg-sky-500' :
                      c === 'purple' ? 'bg-purple-500' :
                      c === 'pink' ? 'bg-pink-500' : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                >
                  Avbryt
                </button>
                <button
                  onClick={handleCreateNote}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Spara Anteckning
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs & Search Navigation */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-lg p-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'notes', label: 'Alla Anteckningar' },
            { id: 'pinned', label: 'Nålade' },
            { id: 'checklists', label: 'Checklistor' },
            { id: 'archived', label: 'Arkiv' },
            { id: 'trash', label: 'Papperskorg' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded font-medium text-[11px] whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-amber-950 text-amber-300 border border-amber-800/60 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Sök anteckningar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-1.5 text-slate-200 text-xs w-full sm:w-48 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Notes Grid Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredNotes.map(note => (
          <div
            key={note.id}
            className={`p-3.5 rounded-lg border transition-all relative group flex flex-col justify-between ${getColorBg(note.color)}`}
          >
            <div>
              {/* Note Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-sm leading-snug">{note.title}</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleTogglePin(note.id, e)}
                    className={`p-1 rounded hover:bg-slate-800/60 transition-colors ${
                      note.isPinned ? 'text-amber-400' : 'text-slate-500 opacity-0 group-hover:opacity-100'
                    }`}
                    title={note.isPinned ? 'Ta bort nål' : 'Nåla fast'}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Text Content or List Items */}
              {note.textContent && (
                <p className="whitespace-pre-wrap leading-relaxed text-slate-300 text-[11px] mb-3">
                  {note.textContent}
                </p>
              )}

              {note.listItems && note.listItems.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {note.listItems.map(item => (
                    <div 
                      key={item.id} 
                      onClick={() => handleToggleCheckItem(note.id, item.id)}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80"
                    >
                      <input 
                        type="checkbox" 
                        checked={item.checked} 
                        readOnly
                        className="accent-amber-500 pointer-events-none"
                      />
                      <span className={`text-[11px] ${item.checked ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {note.tags && note.tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mb-3">
                  {note.tags.map((t, idx) => (
                    <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800 text-[9px] text-slate-400">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Note Footer Actions */}
            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
              <span>Ändrad {note.updatedAt}</span>

              <div className="flex items-center gap-1">
                {onSendToAura && (
                  <button
                    onClick={(e) => handleAskAuraAboutNote(note, e)}
                    className="p-1 hover:bg-cyan-950 text-cyan-400 rounded"
                    title="Skicka till Agent Aura för analys"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={(e) => handleToggleArchive(note.id, e)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-400"
                  title={note.isArchived ? 'Återställ' : 'Arkivera'}
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>

                {note.isTrashed ? (
                  <button
                    onClick={() => handlePermanentDelete(note.id)}
                    className="p-1 hover:bg-rose-950 text-rose-400 rounded"
                    title="Radera permanent"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => handleDeletePrompt(note.id, e)}
                    className="p-1 hover:bg-rose-950 text-rose-400 rounded"
                    title="Släng i papperskorg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {filteredNotes.length === 0 && (
          <div className="col-span-full p-8 text-center bg-slate-900 border border-slate-800 rounded-lg text-slate-400 space-y-2">
            <CheckSquare className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-bold text-slate-300">Inga anteckningar hittades här</p>
            <p className="text-xs">Skapa en ny Google Keep-anteckning eller synka med Google Workspace.</p>
          </div>
        )}
      </div>

      {/* Workspace Confirmation Dialog for Destructive Delete (Mandatory for Workspace Integration) */}
      {confirmDeleteNoteId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-100">Släng anteckning i papperskorgen?</h3>
            </div>
            <p className="text-slate-300 text-xs">
              Är du säker på att du vill flytta denna Google Keep-anteckning till papperskorgen?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setConfirmDeleteNoteId(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
              >
                Avbryt
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-xs"
              >
                Släng anteckning
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
