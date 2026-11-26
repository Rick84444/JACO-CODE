# Use a Claude, ChatGPT or Gemini subscription as JACO's model through the vendor's own CLI

## Problem
JACO can only reach a model through an OpenAI-compatible endpoint and an API key. An operator who pays for a Claude, ChatGPT or Gemini subscription cannot use it as the model behind JACO, and would pay a second time for API usage.

## Solution
- **CLI brains** (`runtime/src/server/connected/cliBrains.mjs`): one owner for the three vendor CLIs (`claude`, `codex`, `gemini`). It reports whether the CLI is installed and signed in, starts the CLI's own browser sign-in, and runs a single tool-less completion through the CLI.
- **JACO never handles the subscription token.** The vendor CLI signs in through its own web page and keeps its own credentials. JACO does not implement OAuth against a vendor, does not read or copy tokens, and strips API-key variables from the CLI's environment so a stray key cannot silently switch a subscription to metered billing.
- **Provider registry**: a signed-in CLI becomes a provider with `kind: 'cli-login'` (`claude-cli`, `codex-cli`, `gemini-cli`) in the existing `ProviderRegistry`; `probe`, `scan` and `chat` branch on that kind. No second registry.
- **GUI**: a "Use your subscription as the brain" card in the provider panel with one flat row per vendor (logo, name, status, one button), in the editor's existing dark palette.

## Acceptance / falsifier
- With a stubbed CLI that reports signed in, `scan()` lists the CLI provider as active and `chat()` returns the CLI's completion text; with a stub that reports signed out, the provider is not active and `chat()` fails closed.
- The CLI child environment contains none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`; the prompt reaches the CLI on stdin, never in argv.
- Falsifier: any code path that reads, logs, stores or forwards a CLI credential, or that starts a CLI sign-in without an operator click, fails the change.

## Observed vs unobserved
Only `claude` exists in the build environment; its `auth status --json`, `auth login --claudeai` and tool-less flags were read from the installed CLI. The `codex` and `gemini` commands follow the vendors' documented behaviour and are NOT observed here. A real sign-in and a real completion need the operator's own computer. Whether a vendor's terms allow scripted use of a subscription is for the operator to confirm.

## Out of scope
Payments, new planner or mission store, a new tool registry, token import or export, Android/Termux sign-in.
