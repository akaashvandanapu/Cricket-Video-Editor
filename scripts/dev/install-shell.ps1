# Install or refresh the cve / cve-be / cve-fe PowerShell commands.
param(
  [string]$CommandsFile = (Join-Path $PSScriptRoot "cve-commands.ps1")
)

$ErrorActionPreference = "Stop"
$CommandsFile = (Resolve-Path $CommandsFile).Path
$Marker = "# cricket-video-editor-command"
$SourceLine = ". `"$CommandsFile`"  $Marker"

function Install-CricketCommandInProfile {
  param([string]$ProfilePath)

  if (-not (Test-Path $ProfilePath)) {
    New-Item -Path $ProfilePath -ItemType File -Force | Out-Null
  }

  $Lines = @(Get-Content $ProfilePath -ErrorAction SilentlyContinue)
  $Filtered = @($Lines | Where-Object {
    $_ -notmatch 'cricket-video-editor-command' -and
    $_ -notmatch 'cricket-commands\.ps1' -and
    $_ -notmatch 'cve-commands\.ps1'
  })

  while ($Filtered.Count -gt 0 -and [string]::IsNullOrWhiteSpace($Filtered[-1])) {
    if ($Filtered.Count -eq 1) {
      $Filtered = @()
    } else {
      $Filtered = @($Filtered[0..($Filtered.Count - 2)])
    }
  }

  $Updated = @($Filtered) + @("", $SourceLine)
  Set-Content -Path $ProfilePath -Value $Updated -Encoding utf8
  Write-Host ">> PowerShell profile updated: $ProfilePath"
}

$ProfilePaths = @(
  $PROFILE
  (Join-Path $HOME "Documents\PowerShell\Microsoft.PowerShell_profile.ps1")
  (Join-Path $HOME "Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1")
)

foreach ($OneDrive in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) {
  if ($OneDrive) {
    $ProfilePaths += (Join-Path $OneDrive "Documents\PowerShell\Microsoft.PowerShell_profile.ps1")
    $ProfilePaths += (Join-Path $OneDrive "Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1")
  }
}

$ProfilePaths |
  Where-Object { $_ } |
  Select-Object -Unique |
  ForEach-Object {
    $Directory = Split-Path $_ -Parent
    if ($Directory -and -not (Test-Path $Directory)) {
      New-Item -Path $Directory -ItemType Directory -Force | Out-Null
    }
    Install-CricketCommandInProfile -ProfilePath $_
  }

Write-Host ">> Open a new PowerShell window, then run: cve-be   (and optionally cve-fe)"
