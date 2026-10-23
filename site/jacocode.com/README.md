# jacocode.com

Source of the public site, served by the Cloudflare Worker `jaco-site`. The files here were taken from the live
site on 2026-10-23 (the original source was not in any repository) and then extended:

- search: canonical address, a shorter description, robots meta, Open Graph and Twitter cards with the replay
  poster, JSON-LD (Organization, WebSite, SoftwareApplication for JACO Lite, SoftwareSourceCode, VideoObject for the
  replay), `sitemap.xml`, and a `Sitemap:` line in `robots.txt` (served by `worker.mjs`);
- links: GitHub and the Hugging Face Space in the hero, a new "Open source" section, the menu and the footer;
- the privacy page has a description and a canonical address.

Layout, style, scripts, sign-in and headers are otherwise the same as the live site.

| Path | Purpose |
| --- | --- |
| `public/` | the site: `index.html`, `privacy.html`, `style.css`, `sky.js`, `replay.js`, `auth.js`, fonts, brand images, replay |
| `worker.mjs` | security headers, `robots.txt`, byte ranges for the video, `www` redirect, routes `/auth/*` to `auth.mjs` |
| `auth.mjs` | Google sign-in (PKCE, sealed cookies) |
| `wrangler.jsonc` | deploy configuration (check it against the deployed worker first) |

## Before deploying

The Lite download is **not** in this folder. A deploy without it removes `/download/jaco-lite.zip` from the live site.
Copy the current files in first:

```bash
mkdir -p public/download
curl -o public/download/jaco-lite.zip        https://jacocode.com/download/jaco-lite.zip
curl -o public/download/jaco-lite.zip.sha256 https://jacocode.com/download/jaco-lite.zip.sha256
```

Then, with a Cloudflare token that may edit Workers:

```bash
npx wrangler deploy
```

Afterwards submit `https://jacocode.com/sitemap.xml` in Google Search Console, and check the page with the Rich Results Test.

`tests/nova/jacocode-site.test.mjs` checks the markup, structured data, links and the worker's `robots.txt`.
