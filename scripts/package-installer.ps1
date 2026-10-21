param(
  [string]$PortableStaging = '',
  [string]$AppName = 'Kami DPS Meter',
  [string]$AppId = 'KamiDPSMeter',
  [ValidateRange(1024,65535)][int]$BackendPort = 4317,
  [string]$OutputName = '',
  [string]$CompilerPath = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($taskVersion -cnotmatch '^\d+\.\d+\.\d+$') { throw 'A release version is required.' }
if ($AppId -cnotmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid installer application id.' }
if ($AppName -cnotmatch '^[A-Za-z0-9 ._-]{3,70}$') { throw 'Invalid installer application name.' }
if (-not $OutputName) { $OutputName = 'Kami-DPS-Meter-Setup-' + $taskVersion }
if ($OutputName -cnotmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid output name.' }
if (-not $PortableStaging) {
  $taskPortableOutput = & (Join-Path $PSScriptRoot 'package-portable.ps1')
  $taskPortable = ($taskPortableOutput -join "`n") | ConvertFrom-Json
  $PortableStaging = $taskPortable.staging
}
$PortableStaging = [IO.Path]::GetFullPath($PortableStaging)
$taskManifest = Join-Path $PortableStaging 'MANIFEST.sha256'
if (-not (Test-Path -LiteralPath $taskManifest)) { throw 'A verified clean portable staging directory is required.' }
$taskListed = @{}
foreach ($taskLine in Get-Content -LiteralPath $taskManifest) {
  if ($taskLine -cnotmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid staging manifest.' }
  $taskExpectedHash = $Matches[1]
  $taskRelative = $Matches[2]
  if ($taskRelative -match '(^|/)(settings|captures|tmp|\.git|\.env)(/|$)' -or $taskRelative -match '(^|/)\.\.?(/|$)' -or [IO.Path]::IsPathRooted($taskRelative)) { throw 'Private or unsafe staging path.' }
  $taskFile = Join-Path $PortableStaging $taskRelative
  if ((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) { throw "Staging checksum mismatch: $taskRelative" }
  $taskListed[$taskRelative.Replace('\','/')] = $true
}
foreach ($taskFile in Get-ChildItem -LiteralPath $PortableStaging -Recurse -File) {
  if ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked staging files are not allowed.' }
  $taskRelative = $taskFile.FullName.Substring($PortableStaging.Length + 1).Replace('\','/')
  if ($taskRelative -ne 'MANIFEST.sha256' -and -not $taskListed.ContainsKey($taskRelative)) { throw "Unlisted staging file: $taskRelative" }
}
$taskBuild = Join-Path $taskRoot ('tmp\installer-build-' + [guid]::NewGuid().ToString('N'))
$taskPayload = Join-Path $taskBuild 'payload'
$taskDist = Join-Path $taskRoot 'dist'
New-Item -ItemType Directory -Force -Path $taskPayload,$taskDist | Out-Null
Copy-Item -LiteralPath $PortableStaging -Destination $taskPayload -Recurse
# Copy-Item of a directory nests it; use the verified copied root as payload.
$taskPayload = Join-Path $taskPayload (Split-Path -Leaf $PortableStaging)
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -Destination $taskPayload | Out-Host
Copy-Item -LiteralPath (Join-Path $taskRoot 'packaging\installer-README.txt') -Destination (Join-Path $taskPayload 'ONCE-OKU.txt') -Force
$taskUtf8 = New-Object Text.UTF8Encoding($false)
$taskMarker = [ordered]@{format='kami-installed/1';version=$taskVersion;port=$BackendPort}
[IO.File]::WriteAllText((Join-Path $taskPayload 'installed.json'),($taskMarker | ConvertTo-Json -Compress),$taskUtf8)
$taskHashes = @(Get-ChildItem -LiteralPath $taskPayload -Recurse -File | Where-Object Name -ne 'MANIFEST.sha256' | Sort-Object FullName | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(),$_.FullName.Substring($taskPayload.Length + 1).Replace('\','/')
})
[IO.File]::WriteAllText((Join-Path $taskPayload 'MANIFEST.sha256'),($taskHashes -join "`n") + "`n",$taskUtf8)

if (-not $CompilerPath) {
  $taskInstalledCompiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($taskInstalledCompiler) { $CompilerPath = $taskInstalledCompiler.Source }
}
$taskCompilerVersion = '6.2.2'
$taskCompilerHash = '8117d10d00a2ad33a1390978ea3872861c330e087914410a6377b22c4c5b8563'
$taskCompilerUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_2_2/innosetup-6.2.2.exe'
if (-not $CompilerPath) {
  $taskTools = Join-Path $taskRoot 'tmp\tooling'
  $taskToolRoot = Join-Path $taskTools 'inno-6.2.2'
  $CompilerPath = Join-Path $taskToolRoot 'app\ISCC.exe'
  if (-not (Test-Path -LiteralPath $CompilerPath)) {
    New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
    $taskInstaller = Join-Path $taskTools 'innosetup-6.2.2.exe'
    if (-not (Test-Path -LiteralPath $taskInstaller)) { Invoke-WebRequest -UseBasicParsing -Uri $taskCompilerUrl -OutFile $taskInstaller }
    if ((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskCompilerHash) { throw 'Official Inno Setup installer checksum mismatch.' }
    $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskInstaller
    if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -cnotmatch 'Martijn Laan') { throw 'Official Inno Setup signature could not be verified.' }
    # Extract compiler files; never execute/install the compiler installer.
    $taskExtractorZip = Join-Path $taskTools 'innoextract-1.9-windows.zip'
    if (-not (Test-Path -LiteralPath $taskExtractorZip)) { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/dscharrer/innoextract/releases/download/1.9/innoextract-1.9-windows.zip' -OutFile $taskExtractorZip }
    if ((Get-FileHash -LiteralPath $taskExtractorZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '6989342c9b026a00a72a38f23b62a8e6a22cc5de69805cf47d68ac2fec993065') { throw 'Pinned extractor checksum mismatch.' }
    $taskExtractorRoot = Join-Path $taskTools 'extractor-1.9'
    Expand-Archive -LiteralPath $taskExtractorZip -DestinationPath $taskExtractorRoot -Force
    & (Join-Path $taskExtractorRoot 'innoextract.exe') --silent --extract --output-dir $taskToolRoot $taskInstaller | Out-Host
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $CompilerPath)) { throw 'Inno Setup compiler extraction failed.' }
  }
}
if (-not (Test-Path -LiteralPath $CompilerPath)) { throw 'Inno Setup compiler is missing.' }
$taskArguments = @('/Qp',('/DAppVersion='+$taskVersion),('/DAppName='+$AppName),('/DAppId='+$AppId),('/DBackendPort='+$BackendPort),('/DPayloadDir='+$taskPayload),('/DOutputDir='+$taskDist),('/DOutputBase='+$OutputName),(Join-Path $taskRoot 'packaging\kami-setup.iss'))
& $CompilerPath @taskArguments | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$taskSetup = Join-Path $taskDist ($OutputName + '.exe')
$taskHash = (Get-FileHash -LiteralPath $taskSetup -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($taskSetup+'.sha256'),$taskHash+'  '+(Split-Path -Leaf $taskSetup)+"`n",$taskUtf8)
$taskReport = [ordered]@{format='kami-installer/1';version=$taskVersion;setup=$taskSetup;bytes=(Get-Item -LiteralPath $taskSetup).Length;sha256=$taskHash;files=$taskHashes.Count+1;payload=$taskPayload;appId=$AppId;appName=$AppName;backendPort=$BackendPort;compiler=$CompilerPath;compilerBootstrap=@{version=$taskCompilerVersion;url=$taskCompilerUrl;sha256=$taskCompilerHash}}
[IO.File]::WriteAllText(($taskSetup+'.json'),($taskReport | ConvertTo-Json -Depth 5),$taskUtf8)
$taskReport | ConvertTo-Json -Depth 5
