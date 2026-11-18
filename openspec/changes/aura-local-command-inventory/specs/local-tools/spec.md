## ADDED Requirements

### Requirement: Observed local command availability
The canonical shell SHALL distinguish executable discovery from policy authorization and execution evidence.

#### Scenario: Host-specific tools
- WHEN an authorized caller requests shell_info
- THEN return actual executable names discovered from absolute PATH entries, bounded and searchable, without exposing environment values or invoking programs
- AND preserve all existing read/write and mission constraints.

### Requirement: Immediate usable local tools
Built-in JACO Shell SHALL default to write access, with existing explicit operator restrictions taking precedence. Discovered known programs SHALL include purpose, example arguments and execution status distinct from capability knowledge.

#### Scenario: First start and semantic tool search
- WHEN the operator starts Aura without custom shell access configuration
- THEN shell_info, shell_read and shell_run are available to a mission with the respective authorized task types
- AND shell_info supports a search by purpose as well as by name
- AND unknown executables are not represented as tested or understood.

## ADDED Requirements: working tool dispatch

### Requirement: Public web read is independent of browser control
Aura SHALL use the existing public HTTPS text fetcher for read-only web research without CDP or a browser-control grant. The fetch server's off switch and web-read mandate SHALL be enforced. Private addresses, credential URLs and redirect-to-private destinations SHALL remain refused.

### Requirement: Canonical MCP identity
The host SHALL resolve exact advertised names first, then a single matching server prefix, and apply the deny list and access mode to the resolved tool. Unknown names SHALL fail; no fuzzy write routing.

### Requirement: Git lifecycle and PR inspection
Aura SHALL be able to read a public GitHub PR and paginated changed files independently of CDP, and request fetch, fast-forward pull, stage, commit and fast-forward merge using the existing Git MCP and mission authority. No protected-branch merge, force push or reset bypass. Remote writes retain their existing approval requirements.

### Requirement: Operator control
Fresh primary Aura installations SHALL enable scoped development grants by default; subordinate agents remain ungranted. Existing saved grants and explicit read/off/deny overrides SHALL not be silently replaced. A new public-web-read permission is initialized once on upgrade, independently of the pre-existing high-risk browser permission. Revocation persists across restart.

