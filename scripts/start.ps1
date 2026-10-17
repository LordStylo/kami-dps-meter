param([switch]$NoBrowser, [ValidateRange(1024,65535)][int]$Port = 4317, [switch]$Idle, [switch]$Browser, [switch]$Overlay)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port"
$taskElectron = Join-Path $taskRoot 'runtime\electron\electron.exe'
if ($Overlay -and -not (Test-Path -LiteralPath $taskElectron)) { throw 'Overlay runtime is missing. Use the overlay portable ZIP, or run scripts/install-overlay.ps1.' }
function Show-Meter {
  if ($NoBrowser) { return }
  if (-not $Browser -and (Test-Path -LiteralPath $taskElectron)) {
    if(-not (Test-Path -LiteralPath (Join-Path $taskRoot 'overlay\mouse-policy.win32-x64.dll')) -or -not (Test-Path -LiteralPath (Join-Path $taskRoot 'overlay\mouse-policy.build.json'))){throw 'Native overlay helper is missing. Run pnpm run overlay:build-native, or extract the complete portable ZIP.'}
    $env:ELECTRON_RUN_AS_NODE=$null
    $taskOverlayMain=Join-Path $taskRoot 'overlay\main.cjs'
    $taskOverlayNode=Join-Path $taskRoot 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $taskOverlayNode)) { $taskOverlayNode=(Get-Command node.exe -ErrorAction SilentlyContinue).Source }
    if (-not $taskOverlayNode) { $taskOverlayNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    $taskLaunchState=& $taskOverlayNode (Join-Path $taskRoot 'overlay\launch-state.cjs') $Port | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Overlay input privilege check failed.' }
    if ($taskLaunchState.elevationRequired -and -not $taskLaunchState.runningElevated) {
      # Match the game's elevation so Windows allows Alt/mouse state access.
      # This restarts only our overlay, leaving live capture and recording alone.
      Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskOverlayMain+'" --port='+$Port+' --quit-overlay') -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait
      $taskHostFile=Join-Path $taskRoot "settings\overlay-$Port\host.json"
      for($taskWait=0;$taskWait -lt 30 -and (Test-Path -LiteralPath $taskHostFile);$taskWait++){Start-Sleep -Milliseconds 100}
      if(Test-Path -LiteralPath $taskHostFile){throw 'Close the previous overlay from its tray menu, then run Baslat.cmd again.'}
      Write-Output 'Aion 2 is elevated. Approve the Windows prompt to enable overlay input in-game.'
      Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskOverlayMain+'" --port='+$Port) -WorkingDirectory $taskRoot -WindowStyle Hidden -Verb RunAs
    } else {
      Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskOverlayMain+'" --port='+$Port) -WorkingDirectory $taskRoot -WindowStyle Hidden
    }
    Write-Output 'Overlay acma istegi gonderildi. Pencereler oyun odaktayken gorunur.'
  } else {
    Start-Process $taskUrl
    Write-Output "Tarayici arayuzu aciliyor: $taskUrl"
  }
}
try { $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2 } catch { $taskStatus=$null }
if ($taskStatus.app -eq 'aion-dps-lab') {
    Write-Output "Veri toplama uygulamasi zaten acik: $taskUrl"
    Show-Meter
    exit 0
}
$taskBundledNode = Join-Path $taskRoot 'runtime\node.exe'
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } elseif ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js 22+ is required. Install Node.js and run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules\koffi\package.json'))) { throw 'Dependencies are missing. Extract the whole portable ZIP, or run pnpm install for a source checkout.' }
if (-not $Idle -and -not (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\Npcap\wpcap.dll'))) { throw 'Npcap is missing. Install it from https://npcap.com/#download then run Baslat.cmd again.' }
& $taskNode -e "if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Windows x64 and Node.js 22+ are required. Extract the Windows x64 portable package again.' }
$taskTemp = Join-Path $taskRoot 'tmp'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
$taskServer = Join-Path $taskRoot 'src\server.mjs'
$env:AION_METER_PORT = [string]$Port
$taskArguments = '"' + $taskServer + '"'
if ($Idle) { $taskArguments += ' --idle' }
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskTemp 'server.log') -RedirectStandardError (Join-Path $taskTemp 'server-error.log')
Set-Content -LiteralPath (Join-Path $taskTemp 'server.pid') -Value $taskProcess.Id
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
  Start-Sleep -Milliseconds 200
  $taskProcess.Refresh()
  if ($taskProcess.HasExited) { throw "Server exited. See $taskTemp\server-error.log" }
  try { $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 1 } catch { $taskStatus=$null }
  if ($taskStatus.app -eq 'aion-dps-lab') {
      Show-Meter
      Write-Output "Aion DPS Lab started: $taskUrl"
      exit 0
  }
}
throw "Server did not become ready. See $taskTemp\server-error.log"
