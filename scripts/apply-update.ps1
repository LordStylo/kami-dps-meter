param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$DataDir,
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$SHA256,
  [ValidateRange(1024,65535)][int]$Port=4317,
  [Parameter(Mandatory=$true)][int]$BackendPid,
  [string]$AckFile,
  [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($Root).TrimEnd('\')
$taskData=[IO.Path]::GetFullPath($DataDir).TrimEnd('\')
$taskInstaller=[IO.Path]::GetFullPath($Installer)
$taskUpdates=[IO.Path]::GetFullPath((Join-Path $taskData 'updates')).TrimEnd('\')+'\'
if($AckFile -and -not ([IO.Path]::GetFullPath($AckFile)).StartsWith($taskUpdates,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update acknowledgement path.'}
if(-not $taskInstaller.StartsWith($taskUpdates,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer is outside the update directory.'}
if([IO.Path]::GetFileName($taskInstaller) -notmatch '^Kami-DPS-Meter-Setup-\d+\.\d+\.\d+\.exe$'){throw 'Invalid installer filename.'}
if((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash -ne $SHA256){throw 'Installer checksum mismatch.'}
$taskMarker=Get-Content -LiteralPath (Join-Path $taskRoot 'installed.json') -Raw | ConvertFrom-Json
if($taskMarker.format -ne 'kami-installed/1'){throw 'This package is not an installed application.'}
$taskLauncher=Join-Path $taskRoot 'Kami DPS Meter.exe'
$taskStop=Join-Path $taskRoot 'scripts\stop.ps1'
if(-not(Test-Path -LiteralPath $taskLauncher -PathType Leaf) -or -not(Test-Path -LiteralPath $taskStop -PathType Leaf)){throw 'Installed application files are missing.'}
if($ValidateOnly){Write-Output 'Update handoff files verified.';exit 0}
function Write-UpdateAcknowledgement([object]$Reply){
  if(-not $AckFile){return}
  $taskAckTemporary=$AckFile+'.tmp'
  [IO.File]::WriteAllText($taskAckTemporary,($Reply|ConvertTo-Json -Compress),(New-Object System.Text.UTF8Encoding($false)))
  [IO.File]::Move($taskAckTemporary,$AckFile)
}
$env:AION_DATA_DIR=$taskData
$env:AION_METER_PORT=[string]$Port
$taskLogs=Join-Path $taskData 'tmp'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskLog=Join-Path $taskLogs ('update-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.log')
Start-Transcript -LiteralPath $taskLog | Out-Null
$taskStopped=$false
$taskShutdownAttempted=$false
try {
  # Confirm the exact local instance again after the download; never close a
  # different portable checkout that happens to have the same port.
  $taskState=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/state" -TimeoutSec 3
  if($taskState.app -ne 'aion-dps-lab' -or $taskState.instance.pid -ne $BackendPid -or
     [IO.Path]::GetFullPath([string]$taskState.instance.root).TrimEnd('\') -ne $taskRoot -or
     [IO.Path]::GetFullPath([string]$taskState.instance.dataDir).TrimEnd('\') -ne $taskData){throw 'The active application changed; update cancelled.'}
  if($taskState.combat.active -or $taskState.combat.encounterActive -or $taskState.research.active -or $taskState.research.armed -or $taskState.archive.activeRun.timingSource -eq 'manual'){throw 'Combat, a recording or a dungeon timer is active; update cancelled.'}
  if($AckFile){Write-UpdateAcknowledgement @{ok=$true};Start-Sleep -Milliseconds 500}
  $taskShutdownAttempted=$true
  & $taskStop -Port $Port -ExpectedBackendPid $BackendPid -RequireIdle
  if(-not $?){throw 'The application could not be closed.'}
  if(Get-Process -Id $BackendPid -ErrorAction SilentlyContinue){throw 'The previous reader is still running.'}
  $taskStopped=$true
  # Keep the ordinary installer visible so the user can review or cancel it.
  # User data lives outside the install directory and is never replaced here.
  $taskSetup=Start-Process -FilePath $taskInstaller -ArgumentList ('/CURRENTUSER /NORESTART /DIR="'+$taskRoot+'"') -PassThru -Wait
  Write-Output ('Installer exit code: '+$taskSetup.ExitCode)
} catch {
  Write-Output ('Update failed: '+$_.Exception.Message)
  if($AckFile -and -not $taskStopped -and -not(Test-Path -LiteralPath $AckFile)){
    Write-UpdateAcknowledgement @{ok=$false;error=$_.Exception.Message}
  }
} finally {
  $taskNeedsRestart=$taskStopped -or ($taskShutdownAttempted -and -not(Get-Process -Id $BackendPid -ErrorAction SilentlyContinue))
  if($taskNeedsRestart -and (Test-Path -LiteralPath $taskLauncher -PathType Leaf)){
    # A cancelled installer leaves the previous version in place. Reuse the
    # launcher's single-instance policy if Setup already reopened the app.
    Start-Process -FilePath $taskLauncher -ArgumentList ('--port='+$Port) -WorkingDirectory $taskRoot -WindowStyle Hidden | Out-Null
  }
  Stop-Transcript | Out-Null
}
