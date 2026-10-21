function Get-KamiRuntimeContext {
  param([Parameter(Mandatory=$true)][string]$Root,[ValidateRange(1024,65535)][int]$Port=4317)
  $taskRuntimeNode=Join-Path $Root 'runtime\node.exe'
  if(-not (Test-Path -LiteralPath $taskRuntimeNode)){$taskRuntimeNode=(Get-Command node.exe -ErrorAction SilentlyContinue).Source}
  if(-not $taskRuntimeNode){$taskRuntimeNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
  if(-not (Test-Path -LiteralPath $taskRuntimeNode)){throw 'Node.js runtime is missing. Extract or reinstall the complete Kami package.'}
  $taskRuntimeJson=& $taskRuntimeNode (Join-Path $Root 'overlay\runtime-paths.cjs') ('--root='+$Root) ('--port='+$Port)
  if($LASTEXITCODE -ne 0){throw 'Kami user data paths could not be resolved.'}
  $taskRuntimePaths=$taskRuntimeJson | ConvertFrom-Json
  if($taskRuntimePaths.installed){$env:AION_DATA_DIR=[string]$taskRuntimePaths.dataDir}
  return [pscustomobject]@{Node=$taskRuntimeNode;Paths=$taskRuntimePaths}
}

function Assert-KamiInstance {
  param([Parameter(Mandatory=$true)]$State,[Parameter(Mandatory=$true)]$Paths)
  if($State.app -ne 'aion-dps-lab' -or $State.instance.id -ne $Paths.instanceId){
    throw 'Bu portta baska klasorden veya eski surumden bir Kami calisiyor. Once o uygulamayi kendi menusunden tamamen kapat; bu uygulama ona dokunmadi.'
  }
}

function Assert-KamiOverlayHost {
  param([Parameter(Mandatory=$true)]$HostState,[Parameter(Mandatory=$true)]$Paths)
  if($HostState.instanceId -ne $Paths.instanceId -or -not ($HostState.pid -as [int]) -or [int]$HostState.pid -le 0){
    throw 'Overlay kimligi bu Kami klasoru ve veri diziniyle eslesmiyor. Overlayi kendi tepsi menusunden kapat.'
  }
}
