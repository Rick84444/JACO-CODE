# jaco-browser-mcp

An MCP server that lets an AI agent use a real Chrome browser, safely.

- **Real input.** Clicks and typing are real mouse and keyboard events through the Chrome DevTools Protocol, not injected JavaScript, so pages behave as they do for a person.
- **Links by name.** The agent clicks "Learn more" the way it reads on the page. If the name is not there, it gets the names that are, and can correct itself.
- **Checked results.** Every click reports where the page went, so the agent knows instead of guessing. Typing is read back from the field.
- **Kept out of reach:** sign-in, payment and security pages, password fields, your local network and `localhost`, and every tab the agent did not open itself.
- **Its own browser profile.** When no browser is listening, it starts Chrome (or Edge) with a separate profile, so the agent never sees your cookies, saved passwords or open tabs.

It is the browser layer of [JACO](https://jacocode.com), a local agent IDE, published on its own.

## Use it

Requires Node.js 22 or newer and Chrome, Edge or Chromium.

```json
{
  "mcpServers": {
    "browser": { "command": "npx", "args": ["-y", "jaco-browser-mcp"] }
  }
}
```

Put this in your client's MCP configuration (Claude Desktop, Claude Code, Cursor, VS Code, Codex and others), restart the client, and ask it to open a page.

## Tools

| Tool | What it does |
| --- | --- |
| `browser_open` | Open a page in a new tab; returns title, text and the names of links and buttons |
| `browser_read` | Read the current page the same way |
| `browser_click` | Click a link or button by its name (or a CSS selector) |
| `browser_type` | Type into a field by its label or placeholder |
| `browser_press` | Press a key, for example Enter |
| `browser_tabs`, `browser_switch_tab`, `browser_close_tab` | Work with the tabs it opened |

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `JACO_CDP_PORT` | `9222` | The browser's remote debugging port |
| `JACO_BROWSER_LAUNCH` | on | `0` never starts a browser; then start one yourself with `--remote-debugging-port` |
| `JACO_BROWSER_CHROME` | found automatically | Path to the browser to start |
| `JACO_BROWSER_PROFILE` | `~/.jaco-browser-mcp/profile` | The separate profile it uses |

## Limits

It works on ordinary web pages, forms and same-origin frames. Frames from other sites, drag and drop and canvas apps are not supported yet. A click on a page that changes without changing its address is reported as not verified, so the agent should read the page again. It does not solve CAPTCHAs and will not sign in for you: those stay with a person.

Measured on our own runs: six simple web tasks (open a page, click a link, read a heading, fill in a form field) went 6 of 6 with an AI agent driving it. That is evidence for simple public pages, not for every site.

MIT licence. Source: [github.com/Rick84444/JACO-CODE](https://github.com/Rick84444/JACO-CODE/tree/main/packages/jaco-browser-mcp).
