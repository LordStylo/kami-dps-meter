param([ValidatePattern('^v\d+\.\d+\.\d+$')][string]$NodeVersion = 'v24.19.0')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDownloads = Join-Path $taskRoot 'tmp\portable-downloads'
$taskDependencies = Join-Path $taskRoot 'tmp\portable-dependency'
$taskBuild = Join-Path $taskRoot ('tmp\portable-build-' + [guid]::NewGuid().ToString('N'))
$taskExtract = Join-Path $taskDependencies ('extract-' + [guid]::NewGuid().ToString('N'))
$taskPackage = Join-Path $taskBuild 'Kami-DPS-Meter'
$taskDist = Join-Path $taskRoot 'dist'
foreach ($dir in @($taskDownloads,$taskDependencies,$taskExtract,$taskPackage,$taskDist)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

# Only verified public distributions and explicit application files enter the ZIP.
$taskNodeName = "node-$NodeVersion-win-x64.zip"
$taskNodeZip = Join-Path $taskDownloads $taskNodeName
$taskSumsPath = Join-Path $taskDownloads "node-$NodeVersion-SHASUMS256.txt"
$taskNodeUrl = "https://nodejs.org/dist/$NodeVersion/$taskNodeName"
Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile $taskSumsPath
if (-not (Test-Path -LiteralPath $taskNodeZip)) { Invoke-WebRequest -UseBasicParsing -Uri $taskNodeUrl -OutFile $taskNodeZip }
$taskSumLine = @(Get-Content -LiteralPath $taskSumsPath | Where-Object { $_ -match ('\s' + [regex]::Escape($taskNodeName) + '$') })
if ($taskSumLine.Count -ne 1) { throw 'Official Node.js checksum entry was not found.' }
$taskExpectedNode = ($taskSumLine[0] -split '\s+')[0]
$taskActualNode = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskNodeZip).Hash.ToLowerInvariant()
if ($taskActualNode -ne $taskExpectedNode) { throw 'Node.js archive checksum mismatch. No package was produced.' }

$taskKoffiVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).dependencies.koffi
if ($taskKoffiVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'A pinned Koffi version is required.' }
$taskLock = Get-Content -LiteralPath (Join-Path $taskRoot 'pnpm-lock.yaml') -Raw
$taskIntegrity = [regex]::Match($taskLock, ('(?ms)^  koffi@' + [regex]::Escape($taskKoffiVersion) + ':\s+resolution: \{integrity: sha512-([^}]+)\}'))
if (-not $taskIntegrity.Success) { throw 'Koffi integrity is missing from the lockfile.' }
$taskKoffiUrl = "https://registry.npmjs.org/koffi/-/koffi-$taskKoffiVersion.tgz"
$taskKoffiTar = Join-Path $taskDependencies "koffi-$taskKoffiVersion.tgz"
if (-not (Test-Path -LiteralPath $taskKoffiTar)) { Invoke-WebRequest -UseBasicParsing -Uri $taskKoffiUrl -OutFile $taskKoffiTar }
$taskExpectedKoffi = ([BitConverter]::ToString([Convert]::FromBase64String($taskIntegrity.Groups[1].Value))).Replace('-','').ToLowerInvariant()
$taskActualKoffi = (Get-FileHash -Algorithm SHA512 -LiteralPath $taskKoffiTar).Hash.ToLowerInvariant()
if ($taskActualKoffi -ne $taskExpectedKoffi) { throw 'Koffi archive checksum mismatch. No package was produced.' }

function Copy-PackageFile([string]$Source, [string]$Relative) {
  $target = Join-Path $taskPackage $Relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $target
}
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $taskRoot 'src') -Recurse -File -Filter '*.mjs') {
  if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source files are not allowed.' }
  Copy-PackageFile $file.FullName $file.FullName.Substring($taskRoot.Length + 1)
}
foreach ($relative in @('Baslat.cmd','Kapat.cmd','scripts\start.ps1','scripts\stop.ps1','public\index.html','public\app.js','public\cube-alerts.js','public\style.css','data\skills.json','data\effect-types.json')) {
  Copy-PackageFile (Join-Path $taskRoot $relative) $relative
}
foreach ($relative in @('Overlay.cmd','Overlay-Yenile.cmd','Tarayici.cmd','scripts\restart-overlay.ps1')) { Copy-PackageFile (Join-Path $taskRoot $relative) $relative }
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $taskRoot 'overlay') -File) { Copy-PackageFile $file.FullName ('overlay\'+$file.Name) }
& (Join-Path $PSScriptRoot 'install-overlay.ps1') -Destination (Join-Path $taskPackage 'runtime\electron') | Out-Host
$taskIcons = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'public\icons\skills') -File -Filter '*.webp')
if ($taskIcons.Count -eq 0) { throw 'Skill icons are missing. Run update:skills before packaging.' }
foreach ($file in $taskIcons) { Copy-PackageFile $file.FullName ('public\icons\skills\' + $file.Name) }
Copy-PackageFile (Join-Path $taskRoot 'packaging\portable-README.txt') 'ONCE-OKU.txt'

Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskNodeZip)
try {
  foreach ($name in @('node.exe','LICENSE')) {
    $entry = $taskArchive.GetEntry("node-$NodeVersion-win-x64/$name")
    if (-not $entry) { throw "Missing Node.js distribution file: $name" }
    $destination = Join-Path $taskPackage "runtime\$name"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
  }
} finally { $taskArchive.Dispose() }

# Extract only known regular runtime files; no install scripts are executed.
$taskKoffiFiles = @('package/index.js','package/indirect.js','package/package.json','package/LICENSE.txt','package/build/koffi/win32_x64/koffi.node')
$taskTar = Join-Path $env:SystemRoot 'System32\tar.exe'
foreach ($name in $taskKoffiFiles) {
  $detail = & $taskTar -tvf $taskKoffiTar $name
  if ($LASTEXITCODE -ne 0 -or @($detail).Count -ne 1 -or -not $detail.StartsWith('-')) { throw "Missing or non-regular dependency file: $name" }
}
& $taskTar -xf $taskKoffiTar -C $taskExtract @taskKoffiFiles
if ($LASTEXITCODE -ne 0) { throw 'Koffi extraction failed.' }
foreach ($name in $taskKoffiFiles) { Copy-PackageFile (Join-Path $taskExtract $name) ('node_modules\koffi\' + $name.Substring(8)) }

$taskUtf8 = New-Object System.Text.UTF8Encoding($false)
$taskManifest = [ordered]@{name='kami-dps-meter-portable';version='0.1.0';private=$true;type='module';engines=@{node='>=22'};dependencies=@{koffi=$taskKoffiVersion}}
[IO.File]::WriteAllText((Join-Path $taskPackage 'package.json'),($taskManifest | ConvertTo-Json -Depth 4),$taskUtf8)
[IO.File]::WriteAllText((Join-Path $taskPackage 'Npcap-indir.url'),"[InternetShortcut]`r`nURL=https://npcap.com/#download`r`n",$taskUtf8)
$taskNotices = @"
Third-party components in this Windows x64 package

Node.js $NodeVersion - OpenJS Foundation and Node.js contributors.
Source distribution: $taskNodeUrl
Full license and bundled dependency notices: runtime/LICENSE

Koffi $taskKoffiVersion - Niels Martignene and contributors (MIT).
Source distribution: $taskKoffiUrl
Full license: node_modules/koffi/LICENSE.txt

Aion 2 skill names and icon art belong to their respective owners.
Catalog and icon source metadata is in data/skills.json.
The meter is an independent prototype and is not an official game client.

Npcap is not included. Download it separately from https://npcap.com/#download
"@
$taskNotices += "`nElectron/Chromium overlay runtime: version is pinned in overlay/runtime.json. Full license notices: runtime/electron/LICENSE and runtime/electron/LICENSES.chromium.html.`nSource: https://github.com/electron/electron/releases`n"
[IO.File]::WriteAllText((Join-Path $taskPackage 'THIRD-PARTY-NOTICES.txt'),$taskNotices,$taskUtf8)
$taskBuildInfo = [ordered]@{format='kami-portable/1';builtAt=[DateTime]::UtcNow.ToString('o');platform='win32-x64';node=$NodeVersion;koffi=$taskKoffiVersion;nodeArchiveSHA256=$taskActualNode;koffiArchiveSHA512=$taskActualKoffi;icons=$taskIcons.Count}
$taskBuildInfo.overlay = $true
[IO.File]::WriteAllText((Join-Path $taskPackage 'BUILD.json'),($taskBuildInfo | ConvertTo-Json),$taskUtf8)

$taskChecksums = @(Get-ChildItem -LiteralPath $taskPackage -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($taskPackage.Length + 1).Replace('\','/')
  if ($relative -match '(^|/)(captures|tmp|settings|research|\.git|\.env)(/|$)' -and -not $relative.StartsWith('src/research/')) { throw "Unexpected private path: $relative" }
  if ($_.Extension -in @('.ndjson','.pcap','.pcapng','.log')) { throw "Unexpected recording: $relative" }
  '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(),$relative
})
[IO.File]::WriteAllText((Join-Path $taskPackage 'MANIFEST.sha256'),($taskChecksums -join "`n") + "`n",$taskUtf8)
$taskStamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow,'Turkey Standard Time').ToString('yyyyMMdd-HHmmss')
$taskZipName = 'kami-dps-meter-overlay-portable-win-x64-' + $taskStamp + '.zip'
$taskZip = Join-Path $taskDist $taskZipName
$taskOutputArchive = [IO.Compression.ZipFile]::Open($taskZip,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem -LiteralPath $taskPackage -Recurse -File) {
    $entryName = 'Kami-DPS-Meter/' + $file.FullName.Substring($taskPackage.Length + 1).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskOutputArchive,$file.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $taskOutputArchive.Dispose() }
$taskZipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskZip).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($taskZip + '.sha256'),"$taskZipHash  $taskZipName`n",$taskUtf8)
[ordered]@{zip=$taskZip;bytes=(Get-Item -LiteralPath $taskZip).Length;sha256=$taskZipHash;files=$taskChecksums.Count+1;staging=$taskPackage} | ConvertTo-Json
