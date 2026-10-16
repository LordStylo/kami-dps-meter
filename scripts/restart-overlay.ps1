param([ValidateRange(1024,65535)][int]$Port=4317)
$ErrorActionPreference='Stop'
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Right-click Overlay-Yenile.cmd and choose Run as administrator. This restarts only the overlay.' }
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskElectron=Join-Path $taskRoot 'runtime\electron\electron.exe'
$taskEntry=Join-Path $taskRoot 'overlay\main.cjs'
$taskHostFile=Join-Path $taskRoot "settings\overlay-$Port\host.json"
$env:ELECTRON_RUN_AS_NODE=$null
Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskEntry+'" --port='+$Port+' --quit-overlay') -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait
for($taskAttempt=0;$taskAttempt -lt 30 -and (Test-Path -LiteralPath $taskHostFile);$taskAttempt++){Start-Sleep -Milliseconds 200}
if(Test-Path -LiteralPath $taskHostFile){throw 'The previous overlay did not close; no duplicate was started.'}
Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskEntry+'" --port='+$Port) -WorkingDirectory $taskRoot -WindowStyle Hidden
