// A read-only projection of Aura's persisted mission DAG. It does not invent steps,
// call tools, mutate the operator's intuition, or claim that plans were executed.
export const REVERSE_GOAL_GRAPH_SCHEMA = 'jaco.reverse-goal-layout/v1';
export const REVERSE_GOAL_ROOT = '@intuition';
const ACTIVE = new Set(['RUNNING','DISPATCHED']);
const HIDDEN = new Set(['SUPERSEDED','CANCELLED']);
const MAX_NODES = 240;
const MAX_EDGES = 1200;
const NODE_WIDTH = 210;
const NODE_HEIGHT = 90;
const GOAL_WIDTH = 318;
const LEVEL_GAP = 158;
const COLUMN_GAP = 36;

const text = value => typeof value === 'string' ? value.slice(0, 1200) : '';
const array = value => Array.isArray(value) ? value : [];
export const isActiveNode = node => ACTIVE.has(String(node?.status || '').toUpperCase());
export const hasVerifiedReceipt = node => String(node?.status || '').toUpperCase() === 'VERIFIED' && array(node?.evidenceRefs).length > 0;
export function nodeVisualState(node, awaitingApproval = false) {
  if (awaitingApproval) return 'approval';
  const status = String(node?.status || '').toUpperCase();
  if (ACTIVE.has(status)) return 'active';
  if (status === 'VERIFIED') return hasVerifiedReceipt(node) ? 'verified' : 'reported';
  if (status === 'FAILED') return 'failed';
  if (status === 'BLOCKED') return 'blocked';
  return 'pending';
}

// An active path is an active action and every dependency link leading from
// the intuition to it. A shared prerequisite is rendered ONCE, with all of its
// real incoming edges preserved. The presentation never clones a mission.
export function reverseGoalLayout(input, options = {}) {
  if (!input || typeof input !== 'object') throw Error('GAMEBOARD_PLAN_REQUIRED');
  const original = array(input.nodes).filter(n => n && !HIDDEN.has(String(n.status || '').toUpperCase()));
  if (original.length > MAX_NODES) throw Error('GAMEBOARD_GRAPH_LIMIT:' + original.length);
  const map = new Map();
  for (const n of original) {
    const key = text(n.key).trim();
    if (!key || key === REVERSE_GOAL_ROOT || key.length > 120 || map.has(key)) throw Error('GAMEBOARD_DUPLICATE_OR_INVALID_NODE');
    map.set(key, { ...n, key, dependencies: [...new Set(array(n.dependencies).map(text))] });
  }
  const children = new Map([[REVERSE_GOAL_ROOT, []]]);
  const parents = new Map();
  const inbound = new Map([...map.keys()].map(key => [key, 0]));
  for (const [key,n] of map) {
    children.set(key, n.dependencies);
    for (const dependency of n.dependencies) {
      if (!map.has(dependency)) throw Error('GAMEBOARD_UNKNOWN_DEPENDENCY:' + dependency);
      if (dependency === key) throw Error('GAMEBOARD_CYCLE:' + key);
      inbound.set(dependency, inbound.get(dependency) + 1);
      const set = parents.get(dependency) || [];
      set.push(key); parents.set(dependency,set);
    }
  }
  const roots = [...map.keys()].filter(key => inbound.get(key) === 0);
  children.set(REVERSE_GOAL_ROOT, roots);
  for (const root of roots) parents.set(root,[REVERSE_GOAL_ROOT]);
  const order = new Map([[REVERSE_GOAL_ROOT,0]]);
  const rank = new Map([[REVERSE_GOAL_ROOT,0]]);
  const queue = [REVERSE_GOAL_ROOT];
  const remaining = new Map([...map.keys()].map(key => [key, parents.get(key)?.length || 0]));
  let visited = 0;
  while (queue.length) {
    const key = queue.shift();
    visited++;
    for (const dependency of children.get(key) || []) {
      rank.set(dependency,Math.max(rank.get(dependency) || 0,(rank.get(key) || 0)+1));
      const left=remaining.get(dependency)-1;
      remaining.set(dependency,left);
      if (left === 0) queue.push(dependency);
    }
  }
  if (visited !== map.size + 1) throw Error('GAMEBOARD_CYCLE');
  const executionFresh = options.executionFresh !== false;
  const reportedActiveCount = [...map.keys()].filter(key => isActiveNode(map.get(key))).length;
  const activeKeys = executionFresh ? [...map.keys()].filter(key => isActiveNode(map.get(key))) : [];
  const activeEdges = new Set();
  const ancestorKeys = new Set([REVERSE_GOAL_ROOT]);
  const walkAncestors = key => {
    if (ancestorKeys.has(key)) return;
    ancestorKeys.add(key);
    for (const parent of parents.get(key) || []) {
      activeEdges.add(parent + '\u0000' + key);
      walkAncestors(parent);
    }
  };
  for (const key of activeKeys) walkAncestors(key);
  const collapsed = new Set(array(options.collapsed).filter(v => typeof v === 'string'));
  const activeOnly = options.activeOnly === true;
  const visible = new Set([REVERSE_GOAL_ROOT]);
  const visibleEdges = [];
  const open = [REVERSE_GOAL_ROOT];
  while (open.length) {
    const parent = open.shift();
    if (collapsed.has(parent)) continue;
    for (const child of children.get(parent) || []) {
      const id = parent + '\u0000' + child;
      if (activeOnly && !activeEdges.has(id)) continue;
      if (visibleEdges.length >= MAX_EDGES) throw Error('GAMEBOARD_EDGE_LIMIT');
      visibleEdges.push({ id, from:parent, to:child, status:activeEdges.has(id) ? 'active' : hasVerifiedReceipt(map.get(child)) ? 'verified' : 'pending' });
      if (!visible.has(child)) { visible.add(child);open.push(child); }
    }
  }
  const layers = new Map();
  for(const key of visible) {
    const depth=rank.get(key) || 0;
    if (!layers.has(depth)) layers.set(depth,[]);
    layers.get(depth).push(key);
  }
  // Source order gives deterministic positions across status changes and
  // prevents animation from moving unrelated nodes when only a receipt changes.
  for (const [index,key] of [...map.keys()].entries()) order.set(key,index+1);
  for (const keys of layers.values()) keys.sort((a,b)=>(order.get(a)||0)-(order.get(b)||0));
  const maxColumns=Math.max(1,...[...layers.values()].map(a=>a.length));
  const width=Math.max(680,maxColumns*(NODE_WIDTH+COLUMN_GAP)+120,GOAL_WIDTH+100);
  const maxDepth=Math.max(0,...layers.keys());
  const height=Math.max(310,maxDepth*LEVEL_GAP+NODE_HEIGHT+105);
  const positions=new Map();
  for (const [depth,keys] of layers) {
    const nodeWidth=depth===0 ? GOAL_WIDTH : NODE_WIDTH;
    const rowWidth=keys.length*nodeWidth + Math.max(0,keys.length-1)*COLUMN_GAP;
    const left=(width-rowWidth)/2;
    keys.forEach((key,i)=>positions.set(key,{x:left+i*(nodeWidth+COLUMN_GAP),y:depth*LEVEL_GAP+15,width:nodeWidth,height:NODE_HEIGHT,level:depth}));
  }
  const nodes=[...visible].map(key => ({
    id:key,kind:key===REVERSE_GOAL_ROOT?'intuition':'step',
    title:key===REVERSE_GOAL_ROOT?text(input.intuition || input.objective):text(map.get(key)?.title),
    status:key===REVERSE_GOAL_ROOT?'intuition':!executionFresh && isActiveNode(map.get(key)) ? 'stale' : nodeVisualState(map.get(key),array(options.waitingMissionIds).includes(map.get(key)?.missionId)),
    rawStatus:key===REVERSE_GOAL_ROOT?text(input.status):text(map.get(key)?.status),
    missionId:key===REVERSE_GOAL_ROOT?null:text(map.get(key)?.missionId)||null,
    evidenceCount:key===REVERSE_GOAL_ROOT?0:array(map.get(key)?.evidenceRefs).length,
    childCount:(children.get(key)||[]).length,
    collapsed:collapsed.has(key),
    ...positions.get(key),
  }));
  const edges=visibleEdges.map(e=>({...e,source:positions.get(e.from),target:positions.get(e.to)}));
  return {
    schema:REVERSE_GOAL_GRAPH_SCHEMA,
    source:'AURA_MISSION_GRAPH', readOnly:true, executed:false,
    width,height,nodes,edges,activeCount:activeKeys.length,reportedActiveCount,executionFresh,
    totalSteps:map.size, visibleSteps:Math.max(0,visible.size-1),
    revisionCount:array(input.changes).length, hiddenSuperseded:array(input.nodes).length-original.length,
    activeOnly, activePathsObserved:activeEdges.size > 0,
  };
}
