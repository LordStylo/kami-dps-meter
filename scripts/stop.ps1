param([ValidateRange(1024,65535)][int]$Port = 4317)
$ErrorActionPreference = 'Stop'
try {
  $taskUrl = "http://127.0.0.1:$Port"
  $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
  if ($taskStatus.app -ne 'aion-dps-lab') { throw 'The service on port 4317 is not Aion DPS Lab.' }
  Invoke-RestMethod -Method Post -Uri "$taskUrl/api/control" -ContentType 'application/json' -Body '{"action":"shutdown"}' | Out-Null
  Write-Output 'Aion DPS Lab stopped.'
} catch { Write-Output $_.Exception.Message }
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskElectron=Join-Path $taskRoot 'runtime\electron\electron.exe'
if (Test-Path -LiteralPath $taskElectron) {
  $env:ELECTRON_RUN_AS_NODE=$null
  $taskOverlayMain=Join-Path $taskRoot 'overlay\main.cjs'
  Start-Process -FilePath $taskElectron -ArgumentList ('"'+$taskOverlayMain+'" --port='+$Port+' --quit-overlay') -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait
  $taskHostFile=Join-Path $taskRoot "settings\overlay-$Port\host.json"
  for($taskWait=0;$taskWait -lt 30 -and (Test-Path -LiteralPath $taskHostFile);$taskWait++){Start-Sleep -Milliseconds 100}
  if(Test-Path -LiteralPath $taskHostFile){Write-Warning 'The previous overlay did not close. Use its tray menu to close it.'}
}
