# Serve the Cricket Video Editor UI from its own static server.
# The UI calls the backend on http://localhost:8500 - start cve-be first.
param([int]$Port = 0)

$ErrorActionPreference = "Stop"
$Project = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Frontend = Join-Path $Project "frontend"
$VenvPython = Join-Path $Project "backend\.venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

if ($Port -le 0) { $Port = if ($env:CVE_FRONTEND_PORT) { [int]$env:CVE_FRONTEND_PORT } else { 8501 } }

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use. Try: cve-fe 8503"
}
if (-not (Get-NetTCPConnection -LocalPort 8500 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Warning "no backend on port 8500 yet - run cve-be in another window"
}

Set-Location $Frontend
Write-Host ">> frontend on http://localhost:$Port   (API: http://localhost:8500)"
& $Python -m http.server $Port --bind 127.0.0.1
