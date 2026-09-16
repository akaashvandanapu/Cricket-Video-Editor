# Start the Cricket Video Editor backend (FastAPI). First run builds backend\.venv.
param([int]$Port = 0)

$ErrorActionPreference = "Stop"
$Project = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Backend = Join-Path $Project "backend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"

if ($Port -le 0) { $Port = if ($env:CVE_BACKEND_PORT) { [int]$env:CVE_BACKEND_PORT } else { 8500 } }

if (-not (Test-Path $VenvPython)) {
  Write-Host ">> creating backend\.venv (Python 3.11)"
  if (Get-Command py -ErrorAction SilentlyContinue) { & py -3.11 -m venv (Join-Path $Backend ".venv") }
  elseif (Get-Command python -ErrorAction SilentlyContinue) { & python -m venv (Join-Path $Backend ".venv") }
  else { throw "Python 3.11 is required. Install it, then run cve-be again." }
  if (-not (Test-Path $VenvPython)) { throw "Could not create $Backend\.venv" }
  Write-Host ">> installing dependencies (one-time, includes mediapipe)"
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt")
}

# the swing check is required: refuse to start without a working pose library
& $VenvPython -c "from mediapipe.python.solutions import pose" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host ">> mediapipe missing or wrong version - reinstalling requirements"
  & $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt")
  & $VenvPython -c "from mediapipe.python.solutions import pose"
  if ($LASTEXITCODE -ne 0) { throw "mediapipe 0.10.21 could not be installed into backend\.venv" }
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use. Try: cve-be 8502"
}

Set-Location $Backend
Write-Host ">> backend API on http://localhost:$Port   (UI: run cve-fe in another window)"
& $VenvPython -m uvicorn app.main:app --app-dir . --port $Port
