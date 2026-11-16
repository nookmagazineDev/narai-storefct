# Update narai-storefct on the Windows server: pull main, build the web, restart the service.
#
#   Easiest: double-click update.bat in the repo root (asks for Administrator itself).
#   Or in PowerShell as Administrator (Restart-Service needs it):
#     powershell -ExecutionPolicy Bypass -File C:\narai-local\narai-storefct\scripts\update.ps1
#
#   Steps:
#     1. git pull --ff-only origin main   (stops if there are local edits that would conflict)
#     2. npm ci                           (only when package-lock.json changed)
#     3. npm run build                    (new dist/)
#     4. Restart-Service NaraiStorefctWeb (reloads the API: server.js, lib/*)
#
#   Messages are in English on purpose: Windows PowerShell 5.1 reads a .ps1 without BOM
#   as ANSI, so Thai text would come out garbled.

param(
  [string]$ServiceName = 'NaraiStorefctWeb',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }
function Run($what) {
  # native commands don't throw on a non-zero exit code; check it ourselves
  & $what[0] $what[1..($what.Length - 1)]
  if ($LASTEXITCODE -ne 0) { Fail "$($what -join ' ') (exit code $LASTEXITCODE)" }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail 'Run PowerShell as Administrator (needed to restart the service).' }
if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) { Fail "Service '$ServiceName' not found." }

Step "Repository: $repo"
$current = (git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) { Fail "Checked out branch is '$current', expected '$Branch'. Run: git checkout $Branch" }
$before = (git rev-parse HEAD).Trim()

Step "Pulling origin/$Branch"
Run @('git', 'pull', '--ff-only', 'origin', $Branch)
$after = (git rev-parse HEAD).Trim()

if ($before -eq $after) {
  Write-Host 'Already up to date.' -ForegroundColor Yellow
  $answer = Read-Host 'Rebuild and restart anyway? (y/N)'
  if ($answer -notmatch '^[yY]') { Write-Host 'Nothing to do.'; exit 0 }
} else {
  Write-Host "`nNew commits:" -ForegroundColor Green
  git --no-pager log --oneline "$before..$after"
}

$changed = if ($before -ne $after) { git diff --name-only $before $after } else { @() }
if ($changed -contains 'package-lock.json' -or -not (Test-Path (Join-Path $repo 'node_modules'))) {
  Step 'package-lock.json changed: npm ci'
  Run @('npm', 'ci')
}

Step 'Building web (npm run build)'
Run @('npm', 'run', 'build')

Step "Restarting service $ServiceName"
Restart-Service $ServiceName
Start-Sleep -Seconds 3
$svc = Get-Service $ServiceName
if ($svc.Status -ne 'Running') { Fail "Service $ServiceName is '$($svc.Status)' after restart." }

Write-Host "`nDONE: $ServiceName is Running at $(git rev-parse --short HEAD)." -ForegroundColor Green
Write-Host 'Open the site and press Ctrl+F5 to load the new build.'
