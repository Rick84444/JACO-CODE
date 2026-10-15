# Start JACO Hands-Off Agent with environment variables from .env
# Usage: .\agents\start-agent.ps1

# Try multiple .env locations
$envFile = $null
$candidates = @(
    (Join-Path $PSScriptRoot ".." ".env"),
    (Join-Path $PSScriptRoot ".." "runtime" ".env.example"),
    (Join-Path $PSScriptRoot ".." "runtime" ".env")
)
foreach ($c in $candidates) {
    if (Test-Path $c) { $envFile = $c; break }
}
if ($envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
    Write-Host "Loaded .env" -ForegroundColor Green
} else {
    Write-Host "No .env found — running without secrets" -ForegroundColor Yellow
}

Write-Host "Starting JACO Hands-Off Agent..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "hands-off-agent.mjs")
