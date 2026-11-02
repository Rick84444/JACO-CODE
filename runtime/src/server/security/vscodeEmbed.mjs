// Opt-in, loopback-only framing exception for the existing JACO GUI inside a VS Code Webview.
// Never relax '/' or any other route: production forbids all framing by default.
export const VSCODE_EMBED_PATH = '/vscode-embed';
export const VSCODE_FRAME_ANCESTORS = "frame-ancestors https://*.vscode-webview.net vscode-webview:";
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function vscodeEmbedAllowed(req, env = process.env) {
  if (env.JACO_VSCODE_EMBED !== '1') return false;
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const ip = String(req.socket?.remoteAddress || '');
  if (!LOOPBACK.has(ip)) return false;
  if (['x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip','forwarded'].some(k => Boolean(req.headers?.[k]))) return false;
  const host = String(req.headers?.host || '').toLowerCase();
  // The Host check also prevents DNS rebinding with arbitrary domains resolving to loopback.
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  return true;
}

export function mountVscodeEmbedHeaders(app, { env = process.env } = {}) {
  app.use((req, res, next) => {
    if (req.path !== VSCODE_EMBED_PATH) return next();
    if (!vscodeEmbedAllowed(req, env)) {
      return res.status(404).json({ success: false, error: 'JACO_VSCODE_EMBED_NOT_AVAILABLE' });
    }
    const csp = String(res.getHeader('Content-Security-Policy') || '');
    // If hardening changed unexpectedly, do not silently remove frame restrictions.
    if (!/(?:^|;\s*)frame-ancestors\s+'none'(?=\s*;|\s*$)/.test(csp)) {
      return res.status(503).json({ success: false, error: 'JACO_VSCODE_EMBED_CSP_UNAVAILABLE' });
    }
    res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors\s+'none'/, VSCODE_FRAME_ANCESTORS));
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-JACO-Embed', 'vscode-v1');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    next();
  });
}
