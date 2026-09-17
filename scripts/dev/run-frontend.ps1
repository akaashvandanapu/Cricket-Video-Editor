# Serve the Cricket Video Editor UI (Vite dev server, hot reload).
# The UI calls the backend on http://localhost:8500 - start cve-be first.
param([int]$Port = 0)

$ErrorActionPreference = "Stop"
$Project = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Frontend = Join-Path $Project "frontend"

if ($Port -le 0) { $Port = if ($env:CVE_FRONTEND_PORT) { [int]$env:CVE_FRONTEND_PORT } else { 8501 } }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js (npm) is required for the UI. Install it from https://nodejs.org, then run cve-fe again."
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use. Try: cve-fe 8503"
}
if (-not (Get-NetTCPConnection -LocalPort 8500 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Warning "no backend on port 8500 yet - run cve-be in another window"
}

Set-Location $Frontend
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  Write-Host ">> installing UI dependencies (one-time)"
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

Write-Host ">> frontend on http://localhost:$Port   (API: http://localhost:8500)"
# call vite directly: PowerShell strips a bare "--", so "npm run dev -- --port"
# would hand the flags to npm instead of vite
& (Join-Path $Frontend "node_modules\.bin\vite.cmd") --port $Port --strictPort
