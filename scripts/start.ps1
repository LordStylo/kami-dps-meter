param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskUrl = 'http://127.0.0.1:4317'
try {
  $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
  if ($taskStatus.app -eq 'aion-dps-lab') {
    if (-not $NoBrowser) { Start-Process $taskUrl }
    Write-Output "Aion DPS Lab is already running: $taskUrl"
    exit 0
  }
} catch { }
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js 22+ is required. Install Node.js and run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules\koffi'))) { throw 'Dependencies are missing. Run pnpm install in the project folder.' }
$taskTemp = Join-Path $taskRoot 'tmp'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
$taskServer = Join-Path $taskRoot 'src\server.mjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskTemp 'server.log') -RedirectStandardError (Join-Path $taskTemp 'server-error.log')
Set-Content -LiteralPath (Join-Path $taskTemp 'server.pid') -Value $taskProcess.Id
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
  Start-Sleep -Milliseconds 200
  if ($taskProcess.HasExited) { throw "Server exited. See $taskTemp\server-error.log" }
  try {
    $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 1
    if ($taskStatus.app -eq 'aion-dps-lab') {
      if (-not $NoBrowser) { Start-Process $taskUrl }
      Write-Output "Aion DPS Lab started: $taskUrl"
      exit 0
    }
  } catch { }
}
throw "Server did not become ready. See $taskTemp\server-error.log"
