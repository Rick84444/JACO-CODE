// JACO Desktop Traction: UIA adapter for the *existing* DOM Traction engine.
// It never dispatches input. The canonical DesktopHandsOffClient and ModelRelay
// remain the only desktop mutation path, with the existing mission/mandate gates.
import { DomTractionEngine } from '../nova/tractionCore.mjs';

const MAX_GAP_MS = 5000;
const validText = value => typeof value === 'string' ? value.trim() : '';
const normalized = value => validText(value).toLowerCase();

function bounds(node) {
  const r = node?.rect;
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
  return [r.x, r.y, r.width, r.height];
}
function descendants(root) {
  if (!root || typeof root !== 'object') return [];
  const found = [];
  const pending = [root];
  while (pending.length && found.length < 2000) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    found.push(node);
    if (Array.isArray(node.children)) pending.push(...node.children.slice(0, 500).reverse());
  }
  return found;
}
function matchingTarget(observation, selector) {
  const nodes = descendants(observation.root).filter(node => {
    if (node.offscreen || node.enabled === false) return false;
    return (!selector.automationId || validText(node.automationId) === selector.automationId) &&
      (!selector.name || normalized(node.name) === normalized(selector.name)) &&
      (!selector.controlType || validText(node.controlType) === selector.controlType) &&
      (!selector.className || validText(node.className) === selector.className);
  });
  if (nodes.length !== 1) throw Error(nodes.length ? 'DESKTOP_TRACTION_AMBIGUOUS_TARGET' : 'DESKTOP_TRACTION_TARGET_MISSING');
  return nodes[0];
}
function identity(node) {
  return JSON.stringify([validText(node.automationId), validText(node.name), validText(node.controlType), validText(node.className)]);
}
function attestedWindow(observation, hwnd) {
  if (!observation || observation.blocked || !observation.root) throw Error('DESKTOP_TRACTION_OBSERVATION_UNAVAILABLE');
  const w = observation.window;
  if (!w || w.hwnd !== hwnd || !Number.isSafeInteger(w.processId) || w.processId <= 0 || !validText(w.processName)) {
    throw Error('DESKTOP_TRACTION_WINDOW_IDENTITY_CHANGED');
  }
  return w;
}

/**
 * Pure, non-actuating, fail-closed gate: bind the semantic target to the same
 * PID/HWND in TWO independent UIA snapshots before dispatch. Do not persist
 * screenshots or text field values here. All decisions use the existing
 * NovaTraction/DomTraction drift/identity logic, not new tracking heuristics.
 */
export function verifyDesktopTraction(first, second, action, {
  firstAt = Date.now(), secondAt = Date.now(), now = Date.now(),
} = {}) {
  const hwnd = action?.hwnd;
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw Error('DESKTOP_TRACTION_HWND_REQUIRED');
  const selector = action?.selector;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw Error('DESKTOP_TRACTION_SELECTOR_REQUIRED');
  // Index selection is order-sensitive; it cannot prove an element's identity.
  if (selector.index !== undefined) throw Error('DESKTOP_TRACTION_INDEX_NOT_STABLE');
  if (!validText(selector.automationId) && !validText(selector.name)) throw Error('DESKTOP_TRACTION_SEMANTIC_TARGET_REQUIRED');
  if (![firstAt, secondAt, now].every(Number.isFinite) ||
      firstAt > secondAt || secondAt > now || now - firstAt > MAX_GAP_MS ||
      now - secondAt > MAX_GAP_MS) throw Error('DESKTOP_TRACTION_OBSERVATION_STALE');

  const w1 = attestedWindow(first, hwnd);
  const w2 = attestedWindow(second, hwnd);
  if (w1.processId !== w2.processId || normalized(w1.processName) !== normalized(w2.processName)) {
    throw Error('DESKTOP_TRACTION_APP_CHANGED');
  }

  const a = matchingTarget(first, selector);
  const b = matchingTarget(second, selector);
  if (identity(a) !== identity(b)) throw Error('DESKTOP_TRACTION_TARGET_CHANGED');
  if ((bounds(a) === null) !== (bounds(b) === null)) throw Error('DESKTOP_TRACTION_GEOMETRY_UNCERTAIN');

  const track = new DomTractionEngine();
  const text = validText(a.name) || validText(a.automationId);
  const role = validText(a.controlType);
  const app = w1.processId + ':' + hwnd;
  track.beginIntent(String(action.type || 'desktop-action'));
  track.acquireTarget({ semanticPurpose: text, role, text, bbox: bounds(a), confidence: 1, source: 'uia' });
  const observed = track.observe({
    app, timestamp: new Date(secondAt).toISOString(),
    semanticTargets: [{ role: validText(b.controlType), text: validText(b.name) || validText(b.automationId), bbox: bounds(b), confidence: 1 }],
  });
  if (observed.state !== 'LOCKED') throw Error('DESKTOP_TRACTION_TARGET_DRIFT');
  const preAction = track.beforeAction(String(action.type || 'desktop-action'));
  if (preAction.state !== 'VERIFYING') throw Error('DESKTOP_TRACTION_LOCK_EXPIRED');

  return Object.freeze({ source: 'uia-dom-traction', verifiedTarget: true, hwnd, processId: w2.processId, state: preAction.state });
}
