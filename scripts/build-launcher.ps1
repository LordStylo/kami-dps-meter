param([string]$Destination = '')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $taskRoot 'tmp\launcher' }
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$taskAssets = Join-Path $taskRoot 'packaging\assets'
New-Item -ItemType Directory -Force -Path $taskAssets | Out-Null
Add-Type -AssemblyName System.Drawing
$taskImages = @()
foreach ($taskSize in @(16,24,32,48,64,128,256)) {
  $taskBitmap = New-Object Drawing.Bitmap($taskSize,$taskSize)
  $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
  $taskGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $taskGraphics.Clear([Drawing.ColorTranslator]::FromHtml('#111B22'))
  $taskPen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#A9E6C5'),([single]($taskSize * 0.075)))
  $taskGraphics.DrawRectangle($taskPen,[single]($taskSize*.12),[single]($taskSize*.10),[single]($taskSize*.76),[single]($taskSize*.80))
  $taskGraphics.DrawLine($taskPen,[single]($taskSize*.37),[single]($taskSize*.28),[single]($taskSize*.37),[single]($taskSize*.72))
  $taskGraphics.DrawLine($taskPen,[single]($taskSize*.64),[single]($taskSize*.28),[single]($taskSize*.38),[single]($taskSize*.51))
  $taskGraphics.DrawLine($taskPen,[single]($taskSize*.39),[single]($taskSize*.49),[single]($taskSize*.65),[single]($taskSize*.72))
  $taskStream = New-Object IO.MemoryStream
  $taskBitmap.Save($taskStream,[Drawing.Imaging.ImageFormat]::Png)
  $taskImages += ,@($taskSize,$taskStream.ToArray())
  $taskStream.Dispose(); $taskPen.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
$taskIconPath = Join-Path $taskAssets 'launcher.ico'
$taskIconStream = [IO.File]::Create($taskIconPath)
$taskWriter = New-Object IO.BinaryWriter($taskIconStream)
try {
  $taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]$taskImages.Count)
  $taskOffset = 6 + 16 * $taskImages.Count
  foreach ($taskImage in $taskImages) {
    $taskDimension = if ($taskImage[0] -eq 256) { 0 } else { $taskImage[0] }
    $taskWriter.Write([byte]$taskDimension); $taskWriter.Write([byte]$taskDimension); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
    $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32); $taskWriter.Write([uint32]$taskImage[1].Length); $taskWriter.Write([uint32]$taskOffset)
    $taskOffset += $taskImage[1].Length
  }
  foreach ($taskImage in $taskImages) { $taskWriter.Write([byte[]]$taskImage[1]) }
} finally { $taskWriter.Dispose(); $taskIconStream.Dispose() }
$taskCompiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw 'Windows .NET Framework C# compiler is missing.' }
$taskExe = Join-Path $Destination 'Kami DPS Meter.exe'
& $taskCompiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/win32icon:$taskIconPath" "/out:$taskExe" (Join-Path $taskRoot 'native\launcher.cs') | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Copy-Item -LiteralPath $taskIconPath -Destination (Join-Path $Destination 'launcher.ico') -Force
[ordered]@{exe=$taskExe;icon=$taskIconPath;sha256=(Get-FileHash -LiteralPath $taskExe -Algorithm SHA256).Hash.ToLowerInvariant();compiler=$taskCompiler} | ConvertTo-Json
