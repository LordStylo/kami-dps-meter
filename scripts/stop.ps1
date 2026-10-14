$ErrorActionPreference = 'Stop'
try {
  $taskUrl = 'http://127.0.0.1:4317'
  $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
  if ($taskStatus.app -ne 'aion-dps-lab') { throw 'The service on port 4317 is not Aion DPS Lab.' }
  Invoke-RestMethod -Method Post -Uri "$taskUrl/api/control" -ContentType 'application/json' -Body '{"action":"shutdown"}' | Out-Null
  Write-Output 'Aion DPS Lab stopped.'
} catch { Write-Output $_.Exception.Message }
