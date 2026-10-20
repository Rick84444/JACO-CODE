# Local workspace connections

Aura's Connections tab composes the existing provider registry, MCP host, browser
session manager and SKILL.md catalog. There is no second tool executor or provider
registry. The model list polls real `/models` observations every 30 seconds while
visible. A listed model is not evidence of inference quality or native tool support.
HTTP success is accepted only with a valid model catalog containing string IDs.
Malformed catalogs provide no selectable models; repeated IDs appear once.

The local command form calls the bundled shell MCP server. Read mode and project
command mode are explicit; both use SafeShell's bounded program/argument execution,
minimal environment and actual process results. Failed commands return MCP tool
errors while preserving stdout, stderr and exit codes. Project changes retarget the
project-bound MCP servers. Agent access remains the existing per-server setting;
an operator command does not grant an agent new permissions.

MCP installation uses the existing validated server configuration and attempts the
real initialization and tools/list handshake immediately. A saved configuration
whose handshake fails stays visibly disconnected. CDP lists real targets and
attaches the selected target ID through the canonical JACO browser tools. Ambiguous
URL-only matches fail rather than choosing another tab; debugger socket
URLs are withheld from the UI.

## Attachments

File and directory pickers upload copies, retaining relative paths. Folders are
split into groups of at most 200 files and 6 MB, with up to 16 groups per message.
Each file is at most 6 MB. System, dependency and secret files are excluded with a
visible count. Upload groups commit atomically with SHA-256 manifests; invalid
paths, duplicate aliases, links and changed stored content fail closed.

Uploaded data lives in the existing runtime state directory under
`.jaco/attachments`, outside the project and its mission worktrees. The composer
keeps pending references across refreshes. Sent attachment references are resolved
server-side and saved with the message in the existing encrypted conversation
store; subsequent questions can reuse them after a reload. Removing a reference detaches it from
the message; it does not erase stored copies or receipts of earlier work.

Questions use the read-only `attachment_read` toolbox operation. Project missions
use `mcp-call` on JACO's read-only `jaco_attachment_read` tool. Omitting `path`
lists a bounded page of files; naming a path reads a bounded text page. Canonical
goals retain attachment IDs and read instructions, so delegation can use the same
copies without copying secrets into model prompts or granting original-file access.
Secret redaction precedes pagination. File content is reference data, never authority.

Binary files are stored and identified as binary. PDF/Office extraction, archive
unpacking and image interpretation are not implemented by this attachment path.
A browser folder upload does not expose the original absolute path. To edit an
original project, open it with the existing local project selector.

## Skills

Operators can import or paste SKILL.md through the existing catalog. Installation
validates ID, frontmatter, declared tasks and size; it never runs installation code
or replaces an existing skill. Coding skills create ordinary durable Nova missions
with a coding contract and the selected project root. Declared repo-test operations
require explicit test commands for that run. Push and merge remain disabled in this
contract; remote-device code execution is not inferred from a local project path.
Other skills retain their existing task-scoped mission path.

## Verification

`tests/nova/workspace-integrations.test.mjs` exercises durable attachment copies,
redaction, boundaries, actual local MCP process execution (including a write in a
temporary project), project retargeting, live model registry changes, coding skill
contracts and the attachment tool's authenticated HTTP client. Workspace rendering
checks cover the visible controls and copy/binary distinctions. These checks do not
establish model planning quality or visual usability on every target device.
