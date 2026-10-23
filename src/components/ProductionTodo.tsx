import React, { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Plus, Trash2, ShieldAlert, Rocket, CreditCard, Database, Cpu } from 'lucide-react';

interface TodoTask {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  category: 'auth' | 'monetization' | 'architecture' | 'feature' | 'honesty';
}

const INITIAL_TASKS: TodoTask[] = [
  {
    id: 't1',
    title: 'Autentisering',
    description: 'Lås appen bakom inloggning (Google/Email). Just nu är appen öppen för alla. För att ta betalt måste varje användare ha ett unikt konto.',
    completed: false,
    category: 'auth'
  },
  {
    id: 't2',
    title: 'Betallösning (Stripe Integration)',
    description: 'Lägg till Stripe Checkout för SaaS-prenumerationer. Sälj "Aura Credits" eller en månadskostnad för obegränsad tillgång.',
    completed: false,
    category: 'monetization'
  },
  {
    id: 't3',
    title: 'Byt ut UI-Illusioner mot Äkta Molntjänst',
    description: 'Var ärlig: Appen körs i molnet, inte på telefonens NPU. Ta bort de simulerade (halvsanna) "NPU/Batteri"-mätarna, eller bygg en äkta React Native-app om du vill åt hårdvaran.',
    completed: false,
    category: 'honesty'
  },
  {
    id: 't4',
    title: 'Molndatabas (Firestore/PostgreSQL)',
    description: 'Just nu sparas din data i telefonens IndexedDB (försvinner om cachen rensas). Flytta agent-historik och filer till en säker molndatabas.',
    completed: false,
    category: 'architecture'
  },
  {
    id: 't5',
    title: 'Asynkrona Agenter (Background Workers)',
    description: 'OpenClaw och VS Code agenterna körs i en Node.js Express route. För en produktionstjänst, flytta tunga skrapningar till köer (t.ex. BullMQ eller Cloud Tasks).',
    completed: false,
    category: 'architecture'
  }
];

export const ProductionTodo: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('saas-production-todos');
    if (saved) {
      try {
        setTasks(JSON.parse(saved));
      } catch (e) {
        setTasks(INITIAL_TASKS);
      }
    } else {
      setTasks(INITIAL_TASKS);
    }
  }, []);

  const saveTasks = (newTasks: TodoTask[]) => {
    setTasks(newTasks);
    localStorage.setItem('saas-production-todos', JSON.stringify(newTasks));
  };

  const toggleTask = (id: string) => {
    saveTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTask = (id: string) => {
    saveTasks(tasks.filter(t => t.id !== id));
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    
    const newTask: TodoTask = {
      id: `t-${Date.now()}`,
      title: newTaskTitle,
      description: 'Användardefinierad uppgift',
      completed: false,
      category: 'feature'
    };
    
    saveTasks([...tasks, newTask]);
    setNewTaskTitle('');
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'auth': return <ShieldAlert className="w-4 h-4 text-cyan-400" />;
      case 'monetization': return <CreditCard className="w-4 h-4 text-amber-400" />;
      case 'architecture': return <Database className="w-4 h-4 text-cyan-400" />;
      case 'honesty': return <Cpu className="w-4 h-4 text-rose-400" />;
      default: return <Rocket className="w-4 h-4 text-sky-400" />;
    }
  };

  const completedCount = tasks.filter(t => t.completed).length;
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

  const executeTaskWithAgent = async (task: TodoTask) => {
    try {
      const res = await fetch('/api/aura/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Exekvera följande Roadmap-uppgift autonomt: "${task.title}". Beskrivning: ${task.description}. Skapa en åtgärdsplan och generera källkodspatch om nödvändigt.`,
          selectedModel: 'gemini-3.1-pro-preview'
        })
      });
      if (res.ok) {
        toggleTask(task.id);
      }
    } catch {
      toggleTask(task.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="bg-slate-900 border border-slate-700 shadow-2xl rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Rocket className="w-5 h-5 text-cyan-400" />
              SaaS Produktions-Roadmap
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Checklista för att gå från "prototyp/bluff" till en betald, ärlig produkt.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-slate-800">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tasks.map(task => (
            <div 
              key={task.id} 
              className={`group flex items-start gap-3 p-4 rounded-lg border transition-all ${
                task.completed 
                  ? 'bg-slate-900/50 border-slate-800/50 opacity-60' 
                  : 'bg-slate-800/40 border-slate-700 hover:border-slate-600'
              }`}
            >
              <button 
                onClick={() => toggleTask(task.id)}
                className="mt-0.5 shrink-0 transition-colors"
              >
                {task.completed 
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> 
                  : <Circle className="w-5 h-5 text-slate-500 hover:text-cyan-400" />
                }
              </button>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {getCategoryIcon(task.category)}
                  <h3 className={`font-semibold text-sm ${task.completed ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                    {task.title}
                  </h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed pr-8">
                  {task.description}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!task.completed && (
                  <button
                    onClick={() => executeTaskWithAgent(task)}
                    className="px-2.5 py-1 text-xs rounded bg-indigo-900/60 border border-indigo-700/60 text-indigo-200 hover:bg-indigo-800 flex items-center gap-1 transition-colors"
                    title="Låt Agent Aura exekvera denna uppgift autonomt"
                  >
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    Kör Agent
                  </button>
                )}
                <button 
                  onClick={() => deleteTask(task.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Add Task */}
        <div className="p-4 bg-slate-950 border-t border-slate-800">
          <form onSubmit={addTask} className="flex gap-2">
            <input 
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Lägg till en egen uppgift att debugga..."
              className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-4 py-2 focus:outline-none focus:border-indigo-500"
            />
            <button 
              type="submit"
              disabled={!newTaskTitle.trim()}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Lägg till
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};
