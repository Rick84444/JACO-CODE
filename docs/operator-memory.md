# Operator memory

Aura remembers what the operator explicitly asks it to remember, and nothing else.

## Behaviour

- A chat message that starts with "Kom ihåg" (or "Remember") saves the rest of the message as a
  memory. The memory must be a verbatim part of one of the operator's own stored messages; a
  memory that quotes anything else, or cites an assistant or system message, is rejected.
- Each memory records the source message id and when the operator said it.
- `/api/aura/chat` adds all memories to the request context on the server, before a provider is
  chosen, so every model (SEER route, a connected provider or a local model) receives the same
  memories. The instruction tells the model these are the only things it remembers about the
  operator.
- The Minne drawer in the chat heading lists memories; Glöm deletes the row. SQLite
  `secure_delete` overwrites the freed pages. The source message stays in the conversation history.

## Ownership and storage

The conversation owner (`runtime/src/server/connected/auraChatSession.mjs`) owns memories, in the
same runtime database and with the same authenticated encryption as chat messages. They are not
written to the Continuum knowledge store or its hash-chained event log, because an append-only log
cannot forget. The API is `GET/POST /api/aura/memory` and `DELETE /api/aura/memory/:id`.

## Acceptance

Accepted when a memory saved in one session is present after restart, is used by a different
provider than the one that was active when it was saved, can say when the operator said it, and is
absent after Glöm and a restart.

Rejected if a memory is stored without the operator's words, survives Glöm, is lost on restart, or
only reaches one provider.

## Verified and not verified

`tests/nova/aura-chat-session.test.mjs` covers the source rule, encryption at rest, restart, the
context builder and deletion. The HTTP routes, the "Kom ihåg" prefix in the UI and an actual
model's use of a memory have not been exercised end to end. The chat context is capped at
12 000 characters (6 000 per source), so a large number of memories is truncated; there is no
retrieval or ranking yet. A deleted row can still exist in the WAL file until the next checkpoint.
