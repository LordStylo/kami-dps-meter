param([ValidateRange(1024,65535)][int]$Port=4317)
$ErrorActionPreference='Stop'
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Right-click Overlay-Yenile.cmd and choose Run as administrator. This restarts only the overlay.' }
$taskRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime-paths.ps1')
$taskContext=Get-KamiRuntimeContext -Root $taskRoot -Port $Port
$taskPaths=$taskContext.Paths
$taskElectron=Join-Path $taskRoot 'runtime\electron\electron.exe'
$taskEntry=Join-Path $taskRoot 'overlay\main.cjs'
$taskHostFile=Join-Path $taskPaths.profile 'host.json'
$taskLogs=$taskPaths.tmp
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskLogPrefix=Join-Path $taskLogs ('overlay-refresh-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$env:ELECTRON_RUN_AS_NODE=$null
Start-Transcript -LiteralPath ($taskLogPrefix+'.log') | Out-Null
try {
# A native crash leaves host.json behind. Only discard the marker after CIM
# confirms that its process no longer exists; never kill a process by stale PID.
if(Test-Path -LiteralPath $taskHostFile){
  $taskPreviousHost=Get-Content -LiteralPath $taskHostFile -Raw | ConvertFrom-Json
  Assert-KamiOverlayHost -HostState $taskPreviousHost -Paths $taskPaths
  $taskPreviousPid=0
  if(-not [int]::TryParse([string]$taskPreviousHost.pid,[ref]$taskPreviousPid) -or $taskPreviousPid -le 0){throw 'Invalid overlay host marker.'}
  $taskPreviousProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskPreviousPid)
  if(-not $taskPreviousProcess){
    $taskCheckedHost=Get-Content -LiteralPath $taskHostFile -Raw | ConvertFrom-Json
    if($taskCheckedHost.pid -eq $taskPreviousPid){
      Remove-Item -LiteralPath $taskHostFile
      Write-Output 'Crashed overlay marker cleared; data capture is still running.'
    }
  }
}
# The running overlay already watches this quit-only request. Starting another
# Electron against its profile just to quit causes Chromium cache-lock warnings.
if(Test-Path -LiteralPath $taskHostFile){Set-Content -LiteralPath (Join-Path (Split-Path -Parent $taskHostFile) 'quit.request') -Value 'quit' -Encoding ascii}
for($taskAttempt=0;$taskAttempt -lt 30 -and (Test-Path -LiteralPath $taskHostFile);$taskAttempt++){Start-Sleep -Milliseconds 200}
if(Test-Path -LiteralPath $taskHostFile){throw 'The previous overlay did not close; no duplicate was started.'}
$taskOverlayArguments='"'+$taskEntry+'" --port='+$Port+' --profile="'+$taskPaths.profile+'"'
if($taskPaths.installed){$taskOverlayArguments+=' --data-dir="'+$taskPaths.dataDir+'"'}
$taskNewOverlay=Start-Process -FilePath $taskElectron -ArgumentList $taskOverlayArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput ($taskLogPrefix+'-out.log') -RedirectStandardError ($taskLogPrefix+'-error.log')
for($taskAttempt=0;$taskAttempt -lt 50;$taskAttempt++) {
  Start-Sleep -Milliseconds 200
  $taskNewOverlay.Refresh()
  if($taskNewOverlay.HasExited){throw "Overlay exited during startup. See $taskLogPrefix-error.log"}
  if(Test-Path -LiteralPath $taskHostFile) {
    try { $taskNewHost=Get-Content -LiteralPath $taskHostFile -Raw | ConvertFrom-Json } catch { continue }
    if($taskNewHost.pid -eq $taskNewOverlay.Id) { Write-Output 'Overlay yenilendi. Veri toplama acik kaldi.';return }
  }
}
throw "Overlay startup could not be confirmed. See $taskLogPrefix-error.log"
} finally { Stop-Transcript | Out-Null }
