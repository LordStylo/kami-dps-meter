param([Parameter(Mandatory=$true)][string]$Setup)
$ErrorActionPreference='Stop'
$taskSource=Split-Path -Parent $PSScriptRoot
$taskWorkspace=Split-Path -Parent $taskSource
$taskReport=Get-Content -LiteralPath ($Setup+'.json') -Raw | ConvertFrom-Json
if($taskReport.appId -notlike 'KamiDPSMeterQA*' -or $taskReport.appName -notlike 'Kami Installer QA*' -or $taskReport.backendPort -eq 4317){throw 'Only a separately compiled QA installer may be tested here.'}
$taskBase=Join-Path $taskSource ('tmp\installer-qa-'+[guid]::NewGuid().ToString('N'))
$taskApp=Join-Path $taskBase 'Installed Application'
$taskData=Join-Path $taskBase 'User Data'
$taskPortable=Join-Path $taskBase 'Old Portable'
if(-not ([IO.Path]::GetFullPath($taskBase)).StartsWith(([IO.Path]::GetFullPath((Join-Path $taskSource 'tmp'))+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe QA directory.'}
$taskAppName=[string]$taskReport.appName
$taskPort=[int]$taskReport.backendPort
$taskRunKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskUninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$taskReport.appId+'_is1'
$taskDesktop=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($taskAppName+'.lnk')
$taskPrograms=Join-Path ([Environment]::GetFolderPath('Programs')) ($taskAppName+'.lnk')
if((Test-Path -LiteralPath $taskUninstallKey) -or (Test-Path -LiteralPath $taskDesktop) -or (Test-Path -LiteralPath $taskPrograms) -or (Get-ItemProperty -LiteralPath $taskRunKey -Name $taskAppName -ErrorAction SilentlyContinue)){throw 'The QA identity already exists; refusing to overwrite it.'}
$taskOriginal=@{}
foreach($taskName in @('AION_DATA_DIR','AION_PETS_DIR','AION_HISTORY_DIR','AION_OVERLAY_PROFILE_DIR','AION_METER_PORT','AION_DISABLE_UPDATES')){$taskOriginal[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process')}
$taskLiveBefore=$null
try{$taskLiveBefore=Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/state' -TimeoutSec 2}catch{}
New-Item -ItemType Directory -Force -Path $taskBase,$taskData,(Join-Path $taskPortable 'settings\archive'),(Join-Path $taskPortable 'settings\pets'),(Join-Path $taskPortable 'captures') | Out-Null
[IO.File]::WriteAllText((Join-Path $taskPortable 'settings\archive\qa-sentinel.txt'),'archive fixture')
[IO.File]::WriteAllText((Join-Path $taskPortable 'settings\pets\qa-sentinel.txt'),'pet fixture')
[IO.File]::WriteAllText((Join-Path $taskPortable 'captures\qa-sentinel.txt'),'capture fixture')
[IO.File]::WriteAllText((Join-Path $taskPortable 'package.json'),'{"name":"kami-dps-meter-portable","version":"0.6.0"}')
$env:AION_DATA_DIR=$taskData
$env:AION_PETS_DIR=Join-Path $taskData 'pets'
$env:AION_HISTORY_DIR=$null
$env:AION_OVERLAY_PROFILE_DIR=$null
$env:AION_METER_PORT=[string]$taskPort
$env:AION_DISABLE_UPDATES='1'
$taskInstalled=$false
$taskResult=[ordered]@{version=$taskReport.version;testAppId=$taskReport.appId;port=$taskPort;directory=$taskBase;tests=@()}
function Assert-QA([bool]$Value,[string]$Name){if(-not $Value){throw ('Failed: '+$Name)};$script:taskResult.tests+= $Name}
function Run-QASetup([string]$Tasks){
  $taskArguments='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /DIR="'+$taskApp+'" /TASKS="'+$Tasks+'" /PORTABLESOURCE="'+$taskPortable+'" /LOG="'+(Join-Path $taskBase 'setup.log')+'"'
  $taskProcess=Start-Process -FilePath $Setup -ArgumentList $taskArguments -WindowStyle Hidden -Wait -PassThru
  if($taskProcess.ExitCode -ne 0){throw ('QA installer exit '+$taskProcess.ExitCode)}
}
try{
  Run-QASetup 'desktopicon,startup,importportable'
  $taskInstalled=$true
  Assert-QA (Test-Path -LiteralPath (Join-Path $taskApp 'Kami DPS Meter.exe')) 'installed executable'
  Assert-QA (Test-Path -LiteralPath $taskUninstallKey) 'Windows uninstall registration'
  Assert-QA (Test-Path -LiteralPath (Join-Path $taskApp 'unins000.exe')) 'uninstaller executable'
  Assert-QA ((Test-Path -LiteralPath $taskDesktop) -and (Test-Path -LiteralPath $taskPrograms)) 'desktop and Start menu shortcuts'
  $taskWsh=New-Object -ComObject WScript.Shell
  $taskShortcut=$taskWsh.CreateShortcut($taskDesktop)
  Assert-QA ($taskShortcut.TargetPath -eq (Join-Path $taskApp 'Kami DPS Meter.exe') -and $taskShortcut.Arguments -eq ('--port='+$taskPort)) 'shortcut executable and isolated port'
  $taskStartup=(Get-ItemProperty -LiteralPath $taskRunKey -Name $taskAppName).$taskAppName
  Assert-QA ($taskStartup -eq ('"'+(Join-Path $taskApp 'Kami DPS Meter.exe')+'" --startup --port='+$taskPort)) 'optional Windows startup registration'
  foreach($taskRelative in @('archive\qa-sentinel.txt','pets\qa-sentinel.txt','captures\qa-sentinel.txt')){Assert-QA (Test-Path -LiteralPath (Join-Path $taskData $taskRelative)) ('portable import '+$taskRelative)}
  Assert-QA ((Get-Content -LiteralPath (Join-Path $taskPortable 'settings\archive\qa-sentinel.txt') -Raw) -eq 'archive fixture') 'original portable preserved'
  $taskCheck=Join-Path $taskBase 'launcher-check.json'
  $taskLauncher=Start-Process -FilePath (Join-Path $taskApp 'Kami DPS Meter.exe') -ArgumentList ('--check="'+$taskCheck+'" --startup --port='+$taskPort) -WindowStyle Hidden -PassThru -Wait
  $taskDry=Get-Content -LiteralPath $taskCheck -Raw | ConvertFrom-Json
  Assert-QA ($taskLauncher.ExitCode -eq 0 -and $taskDry.installed -and $taskDry.dataDir -eq $taskData -and $taskDry.port -eq $taskPort -and $taskDry.missing.Count -eq 0) 'launcher installed data and dependencies'
  # Only this private backend runs: no capture, no overlay input and no personal
  # collection seeding. The production port remains untouched throughout.
  & (Join-Path $taskApp 'scripts\start.ps1') -Port $taskPort -NoBrowser -Idle
  $taskState=Invoke-RestMethod -Uri "http://127.0.0.1:$taskPort/api/state" -TimeoutSec 3
  $taskBackendPid=$taskState.instance.pid
  Assert-QA ($taskState.version -eq $taskReport.version -and $taskState.instance.root -eq $taskApp -and $taskState.instance.dataDir -eq $taskData -and $taskState.mode -eq 'idle') 'installed backend starts in its own data directory'
  & (Join-Path $taskApp 'scripts\start.ps1') -Port $taskPort -NoBrowser -Idle
  Assert-QA ((Invoke-RestMethod -Uri "http://127.0.0.1:$taskPort/api/state" -TimeoutSec 3).instance.pid -eq $taskBackendPid) 'duplicate start reuses the same instance'
  $taskStop=Start-Process -FilePath (Join-Path $taskApp 'Kami DPS Meter.exe') -ArgumentList ('--stop --quiet --port='+$taskPort) -WindowStyle Hidden -PassThru -Wait
  Assert-QA ($taskStop.ExitCode -eq 0 -and -not(Get-Process -Id $taskBackendPid -ErrorAction SilentlyContinue)) 'launcher waits for complete backend shutdown'
  # Reinstall over existing files, preserving user data and removing a startup
  # task explicitly unchecked in the installer.
  Run-QASetup 'desktopicon'
  Assert-QA (-not(Get-ItemProperty -LiteralPath $taskRunKey -Name $taskAppName -ErrorAction SilentlyContinue)) 'unchecked startup option removes only the QA Run entry'
  Assert-QA ((Get-Content -LiteralPath (Join-Path $taskData 'archive\qa-sentinel.txt') -Raw) -eq 'archive fixture') 'reinstall preserves user data'
  & (Join-Path $taskApp 'scripts\start.ps1') -Port $taskPort -NoBrowser -Idle
  $taskBackendPid=(Invoke-RestMethod -Uri "http://127.0.0.1:$taskPort/api/state" -TimeoutSec 3).instance.pid
  $taskUninstall=Start-Process -FilePath (Join-Path $taskApp 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -PassThru -Wait
  Assert-QA ($taskUninstall.ExitCode -eq 0) 'uninstaller completes'
  $taskInstalled=$false
  Assert-QA (-not(Get-Process -Id $taskBackendPid -ErrorAction SilentlyContinue)) 'uninstaller waits for active backend exit'
  Assert-QA (-not(Test-Path -LiteralPath (Join-Path $taskApp 'package.json'))) 'uninstaller removes application files'
  Assert-QA (-not(Test-Path -LiteralPath $taskUninstallKey)) 'uninstaller removes Windows registration'
  Assert-QA (-not(Test-Path -LiteralPath $taskDesktop) -and -not(Test-Path -LiteralPath $taskPrograms)) 'uninstaller removes shortcuts'
  Assert-QA (-not(Get-ItemProperty -LiteralPath $taskRunKey -Name $taskAppName -ErrorAction SilentlyContinue)) 'uninstaller leaves no startup entry'
  Assert-QA ((Get-Content -LiteralPath (Join-Path $taskData 'archive\qa-sentinel.txt') -Raw) -eq 'archive fixture') 'uninstaller preserves personal data'
  if($taskLiveBefore){$taskAfter=Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/state' -TimeoutSec 2;Assert-QA ($taskAfter.cubes.epoch -eq $taskLiveBefore.cubes.epoch -and $taskAfter.version -eq $taskLiveBefore.version) 'production reader and version preserved'}
  $taskResult.passed=$taskResult.tests.Count
  $taskOutput=Join-Path $taskWorkspace 'analysis\installer-validation.json'
  [IO.File]::WriteAllText($taskOutput,($taskResult | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  $taskResult | ConvertTo-Json -Depth 5
}finally{
  if($taskInstalled -and (Test-Path -LiteralPath (Join-Path $taskApp 'unins000.exe'))){
    Start-Process -FilePath (Join-Path $taskApp 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -Wait | Out-Null
  }
  foreach($taskName in $taskOriginal.Keys){[Environment]::SetEnvironmentVariable($taskName,$taskOriginal[$taskName],'Process')}
}
