<#
.SYNOPSIS
  Captures the submission evidence screenshots from the running dashboard.

.DESCRIPTION
  Drives headless Chrome against the local dashboard and writes PNGs to
  docs/assets/evidence/. Reproducible, so the evidence can be regenerated after a
  demo reset or once the payer wallet is funded and settlement hashes appear.

  Prerequisites — all three must already be running:
    npm run merchant     (terminal 1)
    npm run api          (terminal 2)
    npm run dashboard    (terminal 3)

  And at least one demo run must have populated the audit log:
    npm run demo:script

.EXAMPLE
  pwsh -File scripts/capture-evidence.ps1
#>
[CmdletBinding()]
param(
  [string]$DashboardUrl = "http://localhost:3000",
  [string]$ApiUrl       = "http://localhost:4050",
  [string]$OutDir       = "docs/assets/evidence",
  [int]$Width           = 1440,
  [int]$Height          = 900
)

$ErrorActionPreference = "Stop"

$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw "No Chrome or Edge found for headless capture." }

$repoRoot = Split-Path -Parent $PSScriptRoot
$outPath  = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

# Chrome's --screenshot needs an absolute path and does not survive one containing
# spaces. This repository lives under "NTU Project", so shots are staged in a
# space-free temp directory and moved into place afterwards.
$stageDir = Join-Path $env:TEMP "safr-evidence"
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

function Save-Shot {
  param(
    [string]$Url,
    [string]$Name,
    # Drill-down records are taller than a laptop viewport; give them room so the
    # settlement block and record hash are not cut off.
    [int]$ShotHeight = $Height,
    # The Audit Log holds an SSE connection open and takes appreciably longer to
    # give up the frame than the static pages do.
    [int]$TimeoutMs = 180000
  )

  $staged = Join-Path $stageDir "$Name.png"
  $final  = Join-Path $outPath  "$Name.png"
  if (Test-Path $staged) { Remove-Item $staged -Force }

  # The audit feed holds an SSE connection open, so the page never goes idle and
  # Chrome will not exit on its own. The virtual-time budget is what ends the run;
  # the hard kill below is the backstop for when even that does not land.
  $args = @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions",
    "--screenshot=$staged", "--window-size=$Width,$ShotHeight",
    "--virtual-time-budget=8000", $Url
  )
  $proc = Start-Process -FilePath $chrome -ArgumentList $args -PassThru -WindowStyle Hidden
  if (-not $proc.WaitForExit($TimeoutMs)) {
    try { $proc.Kill($true) } catch { }
    Start-Sleep -Seconds 2
  }

  if (Test-Path $staged) {
    Move-Item -Path $staged -Destination $final -Force
    "{0,-32} {1,8:N0} bytes" -f "$Name.png", (Get-Item $final).Length
  } else {
    "{0,-32} FAILED" -f "$Name.png"
  }
}

Write-Host "`nCapturing evidence to $OutDir`n"

# Pick the DENY and ESCALATE records out of the live audit feed so the drill-down
# shots always point at real, current records rather than hardcoded ids.
$feed = Invoke-RestMethod -Uri "$ApiUrl/audit" -TimeoutSec 20
$denyId     = ($feed.items | Where-Object { $_.record.disposition -eq "DENY" }     | Select-Object -First 1).record.audit_id
$escalateId = ($feed.items | Where-Object { $_.record.disposition -eq "ESCALATE" } | Select-Object -First 1).record.audit_id
$allowId    = ($feed.items | Where-Object { $_.record.disposition -eq "ALLOW" }    | Select-Object -First 1).record.audit_id

Save-Shot "$DashboardUrl/"            "01-audit-log"
Save-Shot "$DashboardUrl/escalations" "02-escalations"
Save-Shot "$DashboardUrl/mandate"     "03-mandate"
Save-Shot "$DashboardUrl/agent"       "04-agent"

if ($denyId)     { Save-Shot "$DashboardUrl/audit/$denyId"     "05-drilldown-deny-threshold"   -ShotHeight 1500 }
if ($escalateId) { Save-Shot "$DashboardUrl/audit/$escalateId" "06-drilldown-escalate-review"  -ShotHeight 1650 }
if ($allowId)    { Save-Shot "$DashboardUrl/audit/$allowId"    "07-drilldown-allow-settlement" -ShotHeight 1500 }

Write-Host "`nDone. BaseScan and anchor-verification shots are captured manually —"
Write-Host "see docs/submission/EVIDENCE.md.`n"
