param([Parameter(Mandatory=$true)][string]$Zip)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskZip = (Resolve-Path -LiteralPath $Zip).Path
$taskCheck = Join-Path $taskRoot ('tmp\Portable test ' + [guid]::NewGuid().ToString('N'))
$taskPackage = Join-Path $taskCheck 'Kami-DPS-Meter'
$taskPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskOriginalProfile = $env:USERPROFILE
$taskOriginalAppData = $env:APPDATA
$taskOriginalLocalAppData = $env:LOCALAPPDATA
$taskOriginalPath = $env:PATH
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
  $taskEntries = @($taskArchive.Entries)
  foreach ($entry in $taskEntries) {
    if (-not $entry.FullName.StartsWith('Kami-DPS-Meter/') -or $entry.FullName -match '\\|(^|/)\.\.(/|$)|(^|/)(captures|tmp|settings|private|\.git|\.env)(/|$)|\.(ndjson|pcap|pcapng|log)$') { throw "Unexpected ZIP path: $($entry.FullName)" }
  }
} finally { $taskArchive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($taskZip,$taskCheck)
$taskManifest = Get-Content -LiteralPath (Join-Path $taskPackage 'MANIFEST.sha256')
$taskChecked = 0
foreach ($line in $taskManifest) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw 'Malformed manifest entry.' }
  $expected = $Matches[1]; $relative = $Matches[2]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $taskPackage $relative)).Hash
  if ($actual -ne $expected) { throw "Manifest mismatch: $relative" }
  $taskChecked++
}
if ($taskEntries.Count -ne $taskChecked + 1) { throw 'ZIP contains files missing from the manifest.' }

$taskPortProbe = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$taskPortProbe.Start(); $taskPort = $taskPortProbe.LocalEndpoint.Port; $taskPortProbe.Stop()
$taskUrl = "http://127.0.0.1:$taskPort"
$taskLaunched = $false
try {
  $env:USERPROFILE = Join-Path $taskCheck 'Empty profile'
  $env:APPDATA = Join-Path $env:USERPROFILE 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\Local'
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
  foreach ($dir in @($env:USERPROFILE,$env:APPDATA,$env:LOCALAPPDATA)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (Get-Command node.exe -ErrorAction SilentlyContinue) { throw 'Test isolation failed: system Node is still on PATH.' }
  Push-Location -LiteralPath $taskPackage
  try {
    $taskNode = Join-Path $taskPackage 'runtime\node.exe'
    $taskRuntime = & $taskNode -e "const k=require('koffi'),f=require('node:fs'),c=require('node:crypto'); if(k.load('kernel32.dll').func('uint32 __stdcall GetCurrentProcessId()')()<=0) throw Error('Native module failed'); const m=JSON.parse(f.readFileSync('./overlay/mouse-policy.build.json')); if(m.abi!==1||c.createHash('sha256').update(f.readFileSync('./overlay/mouse-policy.win32-x64.dll')).digest('hex')!==m.dllSHA256) throw Error('Mouse helper checksum failed'); console.log(JSON.stringify({version:process.version,arch:process.arch,koffi:k.version,mousePolicy:'native-v1'}));"
    if ($LASTEXITCODE -ne 0) { throw 'Bundled runtime/native module failed.' }
    $taskLaunched = $true
    & $taskPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $taskPackage 'scripts\start.ps1') -NoBrowser -Port $taskPort
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher failed.' }
    for ($attempt=0; $attempt -lt 20; $attempt++) {
      $taskState = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
      if ($taskState.capture.state -in @('capturing','waiting-for-game','waiting-for-connection','error')) { break }
      Start-Sleep -Milliseconds 300
    }
    if ($taskState.mode -ne 'live' -or $taskState.capture.state -notin @('capturing','waiting-for-game','waiting-for-connection') -or $taskState.capture.error) { throw "Capture failed: $($taskState.capture | ConvertTo-Json -Compress)" }
    $taskServerPid = [int](Get-Content -LiteralPath (Join-Path $taskPackage 'tmp\server.pid'))
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskServerPid"
    if ($taskProcess.ExecutablePath -ne $taskNode) { throw 'Server is not using the bundled runtime.' }
    $taskPage = Invoke-WebRequest -UseBasicParsing -Uri $taskUrl
    if (-not $taskPage.Content.Contains('3 saniyede bir tekrarlan')) { throw 'Current cube reminder UI is missing.' }
    $taskIcon = Get-ChildItem -LiteralPath (Join-Path $taskPackage 'public\icons\skills') -File | Select-Object -First 1
    $taskIconResponse = Invoke-WebRequest -UseBasicParsing -Uri ($taskUrl + '/icons/skills/' + $taskIcon.Name)
    if ($taskIconResponse.StatusCode -ne 200) { throw 'Bundled skill icon was not served.' }
    & $taskPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $taskPackage 'scripts\start.ps1') -NoBrowser -Port $taskPort
    if ($LASTEXITCODE -ne 0 -or [int](Get-Content -LiteralPath (Join-Path $taskPackage 'tmp\server.pid')) -ne $taskServerPid) { throw 'Starting twice did not reuse the existing server.' }
    $taskResult = [ordered]@{zip=$taskZip;manifestFiles=$taskChecked;runtime=($taskRuntime | ConvertFrom-Json);systemNodeOnPath=$false;emptyUserProfile=$true;pathWithSpaces=$true;capture=$taskState.capture.state;iconsServed=$true;duplicateStart='reused';privateFiles='excluded'}
  } finally { Pop-Location }
} finally {
  if ($taskLaunched) { & $taskPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $taskPackage 'scripts\stop.ps1') -Port $taskPort }
  $env:USERPROFILE=$taskOriginalProfile; $env:APPDATA=$taskOriginalAppData; $env:LOCALAPPDATA=$taskOriginalLocalAppData; $env:PATH=$taskOriginalPath
}
Start-Sleep -Milliseconds 800
try { Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 1 | Out-Null; throw 'Portable server did not stop.' } catch [System.Net.WebException] { }
$taskResult.shutdown='passed'
$taskResult | ConvertTo-Json -Depth 4
