param([ValidateRange(1024,65535)][int]$Port=4317,[ValidateRange(0,2147483647)][int]$ExpectedBackendPid=0,[switch]$RequireIdle)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime-paths.ps1')
try {
  $taskContext=Get-KamiRuntimeContext -Root $taskRoot -Port $Port
  $taskPaths=$taskContext.Paths
  $taskUrl="http://127.0.0.1:$Port"
  try{$taskStatus=Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2}catch{$taskStatus=$null}
  if($taskStatus){
    Assert-KamiInstance -State $taskStatus -Paths $taskPaths
    $taskBackendPid=$taskStatus.instance.pid -as [int]
    if(-not $taskBackendPid -or $taskBackendPid -le 0){throw 'Veri toplama uygulamasinin kimligi dogrulanamadi; kapatma istegi gonderilmedi.'}
    if($ExpectedBackendPid -and $ExpectedBackendPid -ne $taskBackendPid){throw 'Kami islemi degisti; kapatma istegi gonderilmedi.'}
    $taskShutdown=@{action='shutdown'}
    if($ExpectedBackendPid){$taskShutdown.expectedPid=$ExpectedBackendPid}
    if($RequireIdle){$taskShutdown.requireIdle=$true}
    $taskShutdownBody=$taskShutdown | ConvertTo-Json -Compress
    $taskDeadline=[DateTime]::UtcNow.AddSeconds(10)
    for(;;){
      $taskChecked=Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
      Assert-KamiInstance -State $taskChecked -Paths $taskPaths
      if($taskChecked.instance.pid -ne $taskBackendPid){throw 'Kami islemi degisti; kapatma istegi gonderilmedi.'}
      try{Invoke-RestMethod -Method Post -Uri "$taskUrl/api/control" -ContentType 'application/json' -Body $taskShutdownBody -TimeoutSec 3 | Out-Null;break}
      catch{if($RequireIdle -or [int]$_.Exception.Response.StatusCode -ne 409 -or $_.ErrorDetails.Message -notmatch 'devam ediyor' -or [DateTime]::UtcNow -ge $taskDeadline){throw};Start-Sleep -Milliseconds 100}
    }
    # A shutdown acknowledgement is not process exit. Never force-kill a PID.
    while(Get-Process -Id $taskBackendPid -ErrorAction SilentlyContinue){
      if([DateTime]::UtcNow -ge $taskDeadline){throw 'Veri toplama islemi zamaninda kapanmadi; dosyalar guncellenmedi.'}
      Start-Sleep -Milliseconds 100
    }
    Write-Output 'Kami veri toplama islemi tamamen kapandi.'
  }else{
    $taskPidFile=Join-Path $taskPaths.tmp 'server.pid'
    if(Test-Path -LiteralPath $taskPidFile){
      $taskPreviousPid=(Get-Content -LiteralPath $taskPidFile -Raw).Trim() -as [int]
      if($taskPreviousPid -and (Get-Process -Id $taskPreviousPid -ErrorAction SilentlyContinue)){throw 'Veri toplama uygulamasi yanit vermiyor. Kendi menusunden tamamen kapat; baska bir islem zorla sonlandirilmadi.'}
    }
  }
  $taskHostFile=Join-Path $taskPaths.profile 'host.json'
  if(Test-Path -LiteralPath $taskHostFile){
    $taskHost=Get-Content -LiteralPath $taskHostFile -Raw | ConvertFrom-Json
    Assert-KamiOverlayHost -HostState $taskHost -Paths $taskPaths
    $taskOverlayPid=[int]$taskHost.pid
    Set-Content -LiteralPath (Join-Path $taskPaths.profile 'quit.request') -Value 'quit' -Encoding ascii
    $taskDeadline=[DateTime]::UtcNow.AddSeconds(8)
    while((Test-Path -LiteralPath $taskHostFile) -or (Get-Process -Id $taskOverlayPid -ErrorAction SilentlyContinue)){
      if([DateTime]::UtcNow -ge $taskDeadline){throw 'Overlay zamaninda kapanmadi. Kendi tepsi menusunden kapat; guncelleme yapma.'}
      Start-Sleep -Milliseconds 100
    }
    Write-Output 'Kami overlay tamamen kapandi.'
  }
}catch{Write-Error $_.Exception.Message;exit 1}
