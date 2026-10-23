# Public site

Static, dependency-free home page for the JACO project. No build step and no third-party requests.

| File | Purpose |
| --- | --- |
| `index.html` | the page, with title, description, canonical, Open Graph, JSON-LD and a visible FAQ |
| `robots.txt`, `sitemap.xml` | crawling and indexing |
| `404.html` | not-found page (`noindex`) |
| `_headers` | security and cache headers (read by Cloudflare Pages and Workers static assets) |
| `assets/` | logo and icon |

The canonical address is `https://jacocode.com/`. If the site is served from another domain, change the canonical,
`og:url`, `og:image`, JSON-LD `@id`/`url`, `robots.txt` and `sitemap.xml` together; `tests/nova/public-site.test.mjs`
checks that they agree.

## Publishing (operator step)

Nothing here deploys itself. With a Cloudflare token that is allowed to edit Pages or Workers, for example:

```bash
npx wrangler pages deploy site --project-name <your-project>
```

Then add `jacocode.com` as the project's custom domain and submit `https://jacocode.com/sitemap.xml` in Google Search Console.

## Before linking the repository publicly

The page links to the GitHub repository. If that repository is private, visitors see a 404. The root `README.md` also warns
that the history once contained credentials and must not be made public by changing visibility alone.
