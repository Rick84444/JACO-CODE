# jacocode.com

Source of the public site, served by the Cloudflare Worker `jaco-site`. The files here were taken from the live
site on 2026-10-23 (the original source was not in any repository) and then extended.

| Path | Purpose |
| --- | --- |
| `public/` | the site: `index.html`, `privacy.html`, `style.css`, `sky.js`, `replay.js`, `auth.js`, fonts, brand images, replay |
| `worker.mjs` | security headers, `robots.txt`, byte ranges for the video, `www` redirect, routes `/auth/*` to `auth.mjs` |
| `auth.mjs` | Google sign-in (PKCE, sealed cookies) |
| `wrangler.jsonc` | deploy configuration (check it against the deployed worker first) |

`tests/nova/jacocode-site.test.mjs` checks the markup, structured data, links, the worker's `robots.txt`, and that
every asset the page references is actually in this folder.

## What a deploy replaces

`wrangler deploy` replaces **every** asset under `public/`. Anything the page references but this folder does not
contain disappears from the live site. Two sets of files are therefore deliberately kept out of Git and written in
by the release workflow immediately before it deploys (see `.gitignore`):

- `public/download/` — `jaco-lite.zip`, the per-platform zips, their `.sha256` files and `latest.json`;
- `public/install.sh` and `public/install.ps1` — copied from `lite/`, the targets of the one-line installers the
  page tells people to run.

Everything else, the brand images included, is committed here so that a deploy cannot drop it.

## Deploying

The supported route is the **JACO Lite download** workflow (`.github/workflows/lite-release.yml`), run from the
Actions tab with `publish=true`. It builds the download from the commit, unpacks and starts it on Linux and on
Windows, writes the files above into `public/`, checks them against `latest.json`, deploys with
`--config site/jacocode.com/wrangler.jsonc`, and then fetches the public URLs back and compares them byte for byte
with what it published. It needs the repository secret `CLOUDFLARE_API_TOKEN`.

The page's copy — download size, platforms, installer commands, what the workspace does — is asserted against the
repository by the test above, so a deploy cannot quietly make the page claim more than the code does.

By hand, with a Cloudflare token that may edit Workers, after putting the downloads and installers in place:

```bash
npx wrangler deploy --config wrangler.jsonc
```

Afterwards submit `https://jacocode.com/sitemap.xml` in Google Search Console, and check the page with the Rich
Results Test.

## Secrets

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` already live on the deployed worker and are kept by
a deploy. They are not in this repository and must not be added to it.
