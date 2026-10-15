# Private shared agent memory

Workplace is the canonical coordination log and session memory. New sessions register, replay visible events, ACK, then become READY. Decisions, findings and handoffs remain in the hub's database between sessions. `joinWorkplace().recall()` returns a bounded in-process view of those records with author, timestamp and reported verification state. This is context retrieval, not model training or proof that a model followed a remembered decision.

## Storage and Git

`memory/`, `.jaco/`, agent state, logs, environments and SQLite files are private local runtime data. Code is synchronized with Git; operational memory is not. Removing formerly tracked SEER files preserves the local files but does not erase old commits, remote copies, forks or backups. Historical cleanup and credential rotation need a separate audit; never claim existing history is private.

Workplace encrypts event bodies, payloads, references and agent cards with AES-256-GCM before writing SQLite. Startup transactionally migrates older plaintext content, checkpoints WAL and compacts the database. Metadata such as agent names, event times, targets, claim paths and session/device identities remains visible in SQLite. Other runtime stores, including existing SEER/Continuum state, are not encrypted by this change.

The installation key is `.jaco/workplace/content.key`, outside Git. Back up the private database and key through a private backup system. Missing/wrong keys fail closed; deleting the key is not a reset procedure. Filesystem permissions and full-disk encryption remain necessary: a user/process that can read the key and database can decrypt the content. This does not claim hardware-vault protection or encryption of every JACO store.

## Devices

The existing hub remains the sole owner. A paired Nova device authenticates with its own revocable device key. The local operator enables its separate memory permission in Enheter. Unapproved devices receive `DEVICE_MEMORY_NOT_AUTHORIZED`; revocation is checked on every request. Remote IDE sessions view the authenticated hub's board without copying memory into Git.

The narrow `/v1/device/workplace` gateway forwards register, sync, ACK, events, heartbeat and session-end calls. Registration binds a unique agent identity/session to the authenticated device. Devices cannot use another device's session or obtain the hub/operator token. Linked sessions can read shared broadcasts and their own targeted events and post findings/handoffs; they cannot publish decisions, create hub missions, claim shared files or deploy through this grant. Mission execution still uses the existing device mission contract.

Device-mode `joinWorkplace` selects `JACO_HUB_URL` and `JACO_DEVICE_KEY` automatically. HTTPS is required outside loopback. Synchronization is online against the private hub; offline multi-writer replication and automatic recovery after hub hardware loss are not implemented. On loss of connectivity agents become DEGRADED_UNSYNCED and do not silently continue shared work.

HTTPS through the existing Cloudflare tunnel encrypts transport but is not end-to-end encryption against Cloudflare: TLS terminates at the provider. No automatic export of shared sensitive memory to cloud model prompts is added. Provider-specific disclosure and client-side end-to-end encryption would need explicit policy and a separate implementation. Credentials belong in the vault, never in memory notes.

## Human overview and evidence

The board shows unique connected agent identities, agents reporting BUSY, and active durable missions separately. Multiple sessions do not multiply an agent count; expired contacts become OFFLINE. BUSY is a status report, not evidence of successful work. Unknown/unavailable sources display unknown counts. Mission cards retain observed steps, receipts and blockers; memory notes retain provenance and do not become verified facts merely by being remembered.

Acceptance covers encrypted persistence/restart, legacy migration, missing/wrong keys, targeted visibility, two paired HTTP clients, session isolation and revocation. Actual synchronization between the operator's separate physical devices still requires those devices to connect and produce receipts.
