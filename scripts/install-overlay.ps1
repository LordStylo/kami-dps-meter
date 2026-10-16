param([string]$Destination)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskConfig=Get-Content -LiteralPath (Join-Path $taskRoot 'overlay\runtime.json') -Raw | ConvertFrom-Json
if ($taskConfig.version -notmatch '^\d+\.\d+\.\d+$' -or $taskConfig.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid overlay runtime pin.' }
if (-not $Destination) { $Destination=Join-Path $taskRoot 'runtime\electron' }
$taskTarget=[IO.Path]::GetFullPath($Destination)
if (-not $taskTarget.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Overlay runtime destination must be inside this workspace.' }
$taskDownloads=Join-Path $taskRoot 'tmp\overlay-downloads'
New-Item -ItemType Directory -Force -Path $taskDownloads | Out-Null
$taskName='electron-v'+$taskConfig.version+'-win32-x64.zip'
$taskZip=Join-Path $taskDownloads $taskName
$taskBase='https://github.com/electron/electron/releases/download/v'+$taskConfig.version+'/'
$taskSums=Join-Path $taskDownloads ('SHASUMS256-v'+$taskConfig.version+'.txt')
if (-not (Test-Path -LiteralPath $taskZip)) { Invoke-WebRequest -UseBasicParsing -Uri ($taskBase+$taskName) -OutFile $taskZip }
if (-not (Test-Path -LiteralPath $taskSums)) { Invoke-WebRequest -UseBasicParsing -Uri ($taskBase+'SHASUMS256.txt') -OutFile $taskSums }
$taskOfficial=@(Get-Content -LiteralPath $taskSums | Where-Object { $_ -match ('\s+\*?'+[regex]::Escape($taskName)+'$') })
if ($taskOfficial.Count -ne 1 -or ($taskOfficial[0] -split '\s+')[0] -ne $taskConfig.sha256) { throw 'Official Electron checksum does not match the pinned release.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $taskZip).Hash -ne $taskConfig.sha256) { throw 'Electron archive checksum mismatch.' }
if (Test-Path -LiteralPath $taskTarget) { throw 'Overlay runtime destination already exists; use a fresh destination.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive=[IO.Compression.ZipFile]::OpenRead($taskZip)
try { foreach ($entry in $taskArchive.Entries) { if ($entry.FullName -match '(^[\\/])|(^|[\\/])\.\.([\\/]|$)|:') { throw 'Unsafe runtime archive path.' } } } finally { $taskArchive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($taskZip,$taskTarget)
if (-not (Test-Path -LiteralPath (Join-Path $taskTarget 'electron.exe'))) { throw 'Overlay runtime executable is missing.' }
Write-Output "Overlay runtime ready: $taskTarget"
