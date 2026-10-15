// Adaptive perception policy for JACO computer-use execution.
//
// The model should not consume a full desktop frame when fresh structural evidence
// can bound the relevant region. This module is pure: it converts a *current* UIA
// observation into a capture plan; it never stores or reuses absolute coordinates.

const TERMINAL_PROCESS = /^(windowsterminal|wt|cmd|powershell|pwsh|conhost|wezterm|alacritty|mintty)$/i;
const TERMINAL_TEXT = /\b(terminal|powershell|pwsh|command prompt|cmd|bash|zsh|fish|wsl|shell|console)\b/i;

function finiteRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x), y = Number(rect.y), width = Number(rect.width), height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function area(rect) { return rect ? rect.width * rect.height : 0; }

function flatten(node, depth = 0, out = []) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  out.push(node);
  for (const child of Array.isArray(node.children) ? node.children : []) flatten(child, depth + 1, out);
  return out;
}

function terminalScore(node) {
  const rect = finiteRect(node?.rect);
  if (!rect) return -Infinity;
  const text = [node.name, node.automationId, node.className, node.controlType].filter(Boolean).join(' ');
  let score = TERMINAL_TEXT.test(text) ? 20 : 0;
  if (['Document', 'Edit', 'Pane', 'Group', 'Custom'].includes(String(node.controlType || ''))) score += 4;
  // Prefer a substantial interaction region over tiny matching labels/icons.
  score += Math.min(12, Math.log10(Math.max(10, area(rect))) * 2);
  return score;
}

function addPadding(rect, padding) {
  const p = Math.max(0, Math.min(64, Number(padding) || 0));
  return {
    x: Math.round(rect.x - p),
    y: Math.round(rect.y - p),
    width: Math.round(rect.width + p * 2),
    height: Math.round(rect.height + p * 2),
  };
}

export function selectPerceptionRegion(observation, {
  padding = 12,
  terminalMaxWidth = 768,
  terminalMaxHeight = 512,
  windowMaxWidth = 896,
  windowMaxHeight = 640,
} = {}) {
  if (!observation || typeof observation !== 'object') {
    return { ok: true, mode: 'full', reason: 'NO_STRUCTURAL_OBSERVATION', maxWidth: windowMaxWidth, maxHeight: windowMaxHeight };
  }
  if (observation.blocked) {
    return { ok: false, mode: 'blocked', reason: 'SENSITIVE_WINDOW', refusal: String(observation.blocked) };
  }

  const windowRect = finiteRect(observation.window?.rect) || finiteRect(observation.root?.rect);
  const processName = String(observation.window?.processName || '');
  const windowName = String(observation.window?.name || '');
  // The root represents the top-level window. Only descendants may become a
  // narrower terminal ROI; otherwise the window-level fallback owns the root.
  const nodes = flatten(observation.root).slice(1);

  let best = null;
  for (const node of nodes) {
    const rect = finiteRect(node.rect);
    const score = terminalScore(node);
    if (!rect || score < 20) continue;
    // Ignore tiny controls and candidates implausibly larger than the top-level window.
    if (rect.width < 180 || rect.height < 80) continue;
    if (windowRect && area(rect) > area(windowRect) * 1.05) continue;
    if (!best || score > best.score || (score === best.score && area(rect) > area(best.rect))) {
      best = { score, rect, node: {
        name: node.name || '',
        automationId: node.automationId || '',
        className: node.className || '',
        controlType: node.controlType || '',
      }};
    }
  }

  if (best) {
    return {
      ok: true,
      mode: 'terminal_roi',
      reason: 'UIA_TERMINAL_REGION',
      rect: addPadding(best.rect, padding),
      anchor: best.node,
      hwnd: observation.window?.hwnd ?? null,
      structuralObservedAt: observation.observedAt || null,
      maxWidth: terminalMaxWidth,
      maxHeight: terminalMaxHeight,
    };
  }

  if (windowRect) {
    const terminalWindow = TERMINAL_PROCESS.test(processName) || TERMINAL_TEXT.test(windowName);
    return {
      ok: true,
      mode: terminalWindow ? 'terminal_window' : 'window_roi',
      reason: terminalWindow ? 'UIA_TERMINAL_WINDOW' : 'UIA_WINDOW_REGION',
      rect: addPadding(windowRect, padding),
      hwnd: observation.window?.hwnd ?? null,
      structuralObservedAt: observation.observedAt || null,
      maxWidth: terminalWindow ? terminalMaxWidth : windowMaxWidth,
      maxHeight: terminalWindow ? terminalMaxHeight : windowMaxHeight,
    };
  }

  return { ok: true, mode: 'full', reason: 'NO_UIA_RECT', maxWidth: windowMaxWidth, maxHeight: windowMaxHeight };
}

export function captureMetrics({ desktopWidth, desktopHeight, sourceWidth, sourceHeight, outputWidth, outputHeight } = {}) {
  const desktopPixels = Math.max(0, Number(desktopWidth) || 0) * Math.max(0, Number(desktopHeight) || 0);
  const sourcePixels = Math.max(0, Number(sourceWidth) || 0) * Math.max(0, Number(sourceHeight) || 0);
  const outputPixels = Math.max(0, Number(outputWidth) || 0) * Math.max(0, Number(outputHeight) || 0);
  const ratio = (a, b) => a > 0 && b > 0 ? Number((a / b).toFixed(2)) : null;
  return {
    desktopPixels,
    sourcePixels,
    outputPixels,
    roiReductionRatio: ratio(sourcePixels, outputPixels),
    desktopReductionRatio: ratio(desktopPixels, outputPixels),
    reductionRatio: ratio(desktopPixels || sourcePixels, outputPixels),
  };
}
