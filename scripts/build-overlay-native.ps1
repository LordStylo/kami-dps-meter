param()
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskPin=Get-Content -LiteralPath (Join-Path $taskRoot 'native\toolchain.json') -Raw | ConvertFrom-Json
if($taskPin.version -notmatch '^\d+\.\d+\.\d+$' -or $taskPin.sha256 -notmatch '^[0-9a-f]{64}$' -or $taskPin.url -ne ('https://ziglang.org/download/'+$taskPin.version+'/zig-x86_64-windows-'+$taskPin.version+'.zip')){throw 'Invalid native compiler pin.'}
$taskSource=Join-Path $taskRoot 'native\mouse-policy.c'
$taskOutput=Join-Path $taskRoot 'overlay\mouse-policy.win32-x64.dll'
$taskMetadata=Join-Path $taskRoot 'overlay\mouse-policy.build.json'
$taskSourceHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $taskSource).Hash.ToLowerInvariant()
if((Test-Path -LiteralPath $taskOutput) -and (Test-Path -LiteralPath $taskMetadata)){
  $taskExisting=Get-Content -LiteralPath $taskMetadata -Raw | ConvertFrom-Json
  if($taskExisting.sourceSHA256 -eq $taskSourceHash -and $taskExisting.compilerSHA256 -eq $taskPin.sha256 -and $taskExisting.dllSHA256 -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $taskOutput).Hash.ToLowerInvariant()){Write-Output 'Native mouse policy is current.';return}
}
$taskDirectory=Join-Path $taskRoot 'tmp\native-toolchain'
New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
$taskArchive=Join-Path $taskDirectory ('zig-'+$taskPin.version+'.zip')
if(-not (Test-Path -LiteralPath $taskArchive)){Invoke-WebRequest -UseBasicParsing -Uri $taskPin.url -OutFile $taskArchive}
if((Get-FileHash -Algorithm SHA256 -LiteralPath $taskArchive).Hash.ToLowerInvariant() -ne $taskPin.sha256){throw 'Native compiler checksum mismatch.'}
$taskCompiler=Join-Path $taskDirectory ('zig-x86_64-windows-'+$taskPin.version+'\zig.exe')
if(-not (Test-Path -LiteralPath $taskCompiler)){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $taskZip=[IO.Compression.ZipFile]::OpenRead($taskArchive)
  try{foreach($taskEntry in $taskZip.Entries){if($taskEntry.FullName -match '(^[\\/])|(^|[\\/])\.\.([\\/]|$)|:'){throw 'Unsafe compiler archive path.'}}}finally{$taskZip.Dispose()}
  [IO.Compression.ZipFile]::ExtractToDirectory($taskArchive,$taskDirectory)
}
$env:ZIG_GLOBAL_CACHE_DIR=Join-Path $taskDirectory 'cache'
$taskWindowsHeaders=Join-Path (Split-Path -Parent $taskCompiler) 'lib\libc\include\any-windows-any'
& $taskCompiler cc -target x86_64-windows-gnu -O2 -shared -nostdlib '-Wl,--entry,DllMain' -isystem $taskWindowsHeaders -Werror -Wall -Wextra $taskSource -lcomctl32 -luser32 -lkernel32 -o $taskOutput
if($LASTEXITCODE -ne 0){throw 'Native mouse policy compilation failed.'}
$taskBuild=[ordered]@{abi=1;platform='win32-x64';compiler=('zig-'+$taskPin.version);compilerSHA256=$taskPin.sha256;sourceSHA256=$taskSourceHash;dllSHA256=(Get-FileHash -Algorithm SHA256 -LiteralPath $taskOutput).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText($taskMetadata,($taskBuild|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output 'Native mouse policy compiled and checksummed.'
