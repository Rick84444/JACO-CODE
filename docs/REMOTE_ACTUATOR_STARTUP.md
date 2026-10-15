# Remote-first startup notes

Default startup now prefers Remote/Desktop AgentOS over CDP.

## Default

```powershell
.\agents\start-all.ps1
```

This starts:

- Remote Bridge on `127.0.0.1:2994`
- SEER on `127.0.0.1:2997`
- Workplace on `127.0.0.1:2995`
- runtime GUI on `127.0.0.1:3000`
- Desktop AgentOS as the foreground executor, unless `JACO_EXECUTOR` is set

CDP, Nova CDP Bridge and the legacy CDP external gateway are skipped.

## Browser-DOM diagnostics

```powershell
$env:JACO_ENABLE_CDP='1'
.\agents\start-all.ps1
```

This additionally starts:

- Chrome CDP on `127.0.0.1:9222`
- Nova CDP Bridge on `127.0.0.1:4243`
- CDP MCP facade on `127.0.0.1:2996`
- legacy CDP gateway on `127.0.0.1:4250`

Use this only when the task needs DOM-level browser automation or CDP diagnostics.

## Mutation gate

Remote Bridge exposes mutation tools through ModelRelay, but mutations still fail closed unless `JACO_REMOTE_ALLOW_MUTATIONS=1` and a signed autonomy mandate exists.
