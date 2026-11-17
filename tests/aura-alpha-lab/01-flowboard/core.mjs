export function kanban(tasks, action) {
  const states=['todo','doing','done']; const copy=tasks.map(t=>({...t}));
  if(action.type==='add'){const title=String(action.title||'').trim();if(!title||title.length>120||!action.id||copy.some(t=>t.id===action.id))throw Error('Invalid task');return [...copy,{id:action.id,title,status:'todo'}];}
  const index=copy.findIndex(t=>t.id===action.id);if(index<0)throw Error('Task not found');
  if(action.type==='delete')return copy.filter(t=>t.id!==action.id);
  if(action.type==='move'&&states.includes(action.status)){copy[index].status=action.status;return copy;}
  throw Error('Invalid action');
}
