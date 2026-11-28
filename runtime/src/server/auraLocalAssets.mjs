// Operator-installed local assets that must not be served like ordinary static files.
// The photoreal head is a person's likeness: it lives outside public/ (so express.static and the Vite build never
// see it) and is served only to the local operator, not to a signed-in remote IDE session, proxy or other host.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {auraSplatDir} from '../lib/auraSplatInstall.mjs';

export const AURA_SPLAT_ROUTE = '/aura-splat';

// Local operator only: no remote IDE session, no proxy headers, loopback peer. `guard` is the server's
// requireLocalUi (loopback and proxy checks); this adds the refusal of a remote IDE session, which that guard allows.
export const localOperatorOnly = guard => (req, res, next) =>
  req.ideSession ? res.status(403).json({success: false, error: 'LOCAL_OPERATOR_REQUIRED'}) : guard(req, res, next);

// Must be mounted before any express.static over public/ and before the SPA fallback.
export function mountAuraSplatAssets(app, {root, guard, serveStatic}) {
  const dir = auraSplatDir(root);
  app.use(AURA_SPLAT_ROUTE,
    (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); },
    localOperatorOnly(guard),
    serveStatic(dir, {dotfiles: 'deny', index: false, redirect: false}),
    // A missing bundle is a plain 404, never the SPA page (a module import of HTML is a confusing failure).
    (_req, res) => res.status(404).json({success: false, error: 'AURA_SPLAT_NOT_INSTALLED'}));
  // An earlier layout installed under public/. The route above already shadows /aura-splat, so it is never served
  // there, but the client build would still copy it; the caller warns.
  return {dir, legacyPublicCopy: existsSync(join(root, 'public', 'aura-splat'))};
}
