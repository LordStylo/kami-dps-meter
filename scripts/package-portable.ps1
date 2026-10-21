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
foreach ($relative in @('Baslat.cmd','Uygulama.cmd','Kapat.cmd','scripts\start.ps1','scripts\stop.ps1','scripts\runtime-paths.ps1','scripts\apply-update.ps1','public\index.html','public\app.js','public\workbench.js','public\cube-alerts.js','public\cube-map.js','public\pets.js','public\pets-map.js','public\style.css','data\skills.json','data\bosses.json','data\effect-types.json','data\combat-analytics.json','data\world-maps.json','data\pets.json','data\pet-maps.json')) {
  Copy-PackageFile (Join-Path $taskRoot $relative) $relative
}
$taskMapCatalog=Get-Content -LiteralPath (Join-Path $taskRoot 'data\world-maps.json') -Raw | ConvertFrom-Json
foreach($taskMap in $taskMapCatalog.maps) {
  if($taskMap.image -cnotmatch '^/maps/[A-Za-z0-9_]+\.webp$'){throw 'Invalid map asset path.'}
  $taskMapRelative='public'+$taskMap.image
  $taskMapSource=Join-Path $taskRoot $taskMapRelative
  if((Get-FileHash -LiteralPath $taskMapSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskMap.sha256){throw 'Map image checksum mismatch.'}
  Copy-PackageFile $taskMapSource $taskMapRelative
}
$taskPetCatalog=Get-Content -LiteralPath (Join-Path $taskRoot 'data\pets.json') -Raw | ConvertFrom-Json
foreach($taskAsset in $taskPetCatalog.assets.PSObject.Properties) {
  if($taskAsset.Name -cnotmatch '^/icons/pets/[A-Za-z0-9_]+\.webp$'){throw 'Invalid pet icon path.'}
  $taskRelative='public'+$taskAsset.Name
  if((Get-FileHash -LiteralPath (Join-Path $taskRoot $taskRelative) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskAsset.Value.sha256){throw 'Pet icon checksum mismatch.'}
  Copy-PackageFile (Join-Path $taskRoot $taskRelative) $taskRelative
}
$taskPetMapCatalog=Get-Content -LiteralPath (Join-Path $taskRoot 'data\pet-maps.json') -Raw | ConvertFrom-Json
foreach($taskMap in $taskPetMapCatalog.maps) { foreach($taskTile in $taskMap.tiles) {
  if($taskTile.image -cnotmatch '^/pet-maps/[A-Za-z0-9_]+\.webp$'){throw 'Invalid pet map tile path.'}
  $taskRelative='public'+$taskTile.image
  if((Get-FileHash -LiteralPath (Join-Path $taskRoot $taskRelative) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskTile.sha256){throw 'Pet map tile checksum mismatch.'}
  Copy-PackageFile (Join-Path $taskRoot $taskRelative) $taskRelative
} }
foreach ($relative in @('Overlay.cmd','Overlay-Yenile.cmd','Tarayici.cmd','scripts\restart-overlay.ps1')) { Copy-PackageFile (Join-Path $taskRoot $relative) $relative }
& (Join-Path $PSScriptRoot 'build-overlay-native.ps1') | Out-Host
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $taskRoot 'overlay') -File) {
  if ($file.Extension -notin @('.cjs','.mjs','.js','.html','.css','.json','.dll')) { continue }
  if ($file.Extension -eq '.dll' -and $file.Name -ne 'mouse-policy.win32-x64.dll') { throw "Unexpected overlay DLL: $($file.Name)" }
  Copy-PackageFile $file.FullName ('overlay\'+$file.Name)
}
& (Join-Path $PSScriptRoot 'install-overlay.ps1') -Destination (Join-Path $taskPackage 'runtime\electron') | Out-Host
$taskIcons = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'public\icons\skills') -File -Filter '*.webp')
if ($taskIcons.Count -eq 0) { throw 'Skill icons are missing. Run update:skills before packaging.' }
foreach ($file in $taskIcons) { Copy-PackageFile $file.FullName ('public\icons\skills\' + $file.Name) }
Copy-PackageFile (Join-Path $taskRoot 'packaging\portable-README.txt') 'ONCE-OKU.txt'
$taskGuideUpdate = @'


19 EKIM 2026 - KAMI UYGULAMASI VE KALICI GECMIS

Overlay DPS penceresindeki Ayrintilar veya tepsi menusundeki
Kami uygulamasini ac, ayri Kami penceresini acar. Bu pencereyi kapatmak
veri toplamayi durdurmaz. Oyun ici overlay'in Alt/fare kurallari aynidir.

Canli ve kayitli savaslarda alinan hasar/DTPS, kaynaklar, buff uptime,
destek/rDPS, rotasyon ve gozlenen boss HP/stagger ayrintilari vardir.
rDPS = (hasar - alinan destek katkisi + verilen destek katkisi) / ortak sure.
Gerekli dis etki verisi bilinmiyorsa sonuc -- gosterilir. Model ve genel
meta veri Questlog 0.1.35 incelemesine dayanir; butun eski kayitlarda veya
canli Questlog ile kesin rDPS eslesmesi dogrulanmis degildir.

Tamamlanan savaslar settings/archive altinda kalici yerel JSON olarak
saklanir. Savas gecmisinden kayit acmak canli yakalamayi durdurmaz.
Veri ve araclar icindeki eski Questlog yeniden hesaplama araci ise
canliyi durdurur. JSON indir ve Sohbete kopyala yerel ciktilardir;
otomatik yukleme/siralama yoktur. Kopyalama oyuna mesaj gondermez.

Dungeon girisinde Dungeon turunu baslat, cikista Tamamlandi kullan.
Turu bitir, tamamlanma sonucu eklemeden kapatir. Boss olumu veya bolge
degisimi kendiliginden dungeon clear sayilmaz. Bolge oturumlarinda
gozlenen sure, kullanici tamamlamali turlarda clear suresi gosterilir.
Beklenmedik kapanistan kalan tur yeniden acilista kesildi sayilir.

Boss'ta olumden/menzilden donus icin ayni haritada varsayilan 5 dakikalik
kurtarma penceresi vardir. Ayni karakterin yeni entity kimligi eslenir;
eski hasar, pet ve buff sahipligi korunur. Gercek bolge degisimi, boss'un
tam HP'ye donmesi veya boss olumu onceki bitis kurallarini uygular.
Normal boss idle hem yeni vurusta hem timer'da 90 saniyedir. Donus sonrasi
DPS'nin dusmesi aradaki sureye bagli olabilir; toplam hasar silinmesi degildir.

Bu motoru etkinlestirmek icin uygun zamanda Kapat.cmd ile normal kapatip
Baslat.cmd ile bir kez yeniden baslat. Overlay-Yenile.cmd yalnizca arayuzu
yeniler. Devam eden oyunda backend'i gereksiz yere yeniden baslatma.
Kimlik bilgisi eksikse olcer acikken bolge degistir veya teleport yap.
Paylasilacak temiz pakete kendi settings, captures ve tmp klasorlerini ekleme.

KUP YAKINLIK GOSTERGESI (0.2.1)
Guncel konumda yaklasik yatay mesafe ve yaklasiyorsun/uzaklasiyorsun
gosterilir. Eksik/bayat konumda yakinlik bilinmiyor yazar; tahmini
konum ayrica belirtilir. Ilk alarm ve 3 saniyelik tekrar aynidir.
Kesintisiz yuruyus takibi ve fiziksel metre kalibrasyonu dogrulanmamistir.

20 EKIM 2026 - KUP HARITASI (0.3.0)
Uygulama.cmd ile acilan uygulamada Hidden cube menusunu sec.
Yedi yerel bolge haritasi, algilanan kup isaretleri ve alinan karakter
konumu gosterilir. Takip, yakinlastirma ve haritayi surukleme vardir.
Konum yeni oyun verisiyle guncellenir; gri nokta son bilinen konumdur.
Kisa paket kesintisinde bolge son dogrulanan haritadan alinir ve belirtilir.
Yeni acilista bolge/kimlik gelmediyse olcer acikken bir kez bolge degistir.
Haritalar yereldir; kullanimda CDN baglantisi gerekmez. Kaynak: NCSOFT/Questlog.

KUP HARITASI OVERLAY (0.4.0)
Kucuk harita seni merkezde takip eder. Alt ile basligindan tasi;
arti/eksi ile yakinlastir, Gizle ile kapat. Arayuz menusundeki
Kup haritasi anahtari elle acip kapatir. Yeni kup algilaninca ses
kapali olsa da acilir; gizledigin ayni kup tekrar acmaz.
Overlay-Yenile.cmd dosyasini yonetici olarak calistirmak yeterlidir;
bu arayuz guncellemesi icin canli okuyucuyu yeniden baslatma.

PETLER MENUSU (0.5.0)
Petler menusunde koleksiyon, seviyeler, ruhlar ve bolge/taraf filtreleri vardir.
Turler ve filtreler soldadir; kompakt pet listesi haritanin yaninda kalir.
Liste 3. seviyeye kalan ruha gore siralanir, tamamlananlar gizlenebilir.
Tur ozetinde sahip olunan ve 3. seviye tamamlanan sayilari ayri gosterilir.
Pet satirlarinda bulundugu taraflar Elyos, Asmodian ve Abyss etiketleridir.
Birden fazla tarafta bulunanlarda tum ilgili etiketler gosterilir.
Pet haritasinda bolge secimi acilir liste yerine bolge dugmeleridir.
Haritada ac ayni uygulamanin icinde acilir; kup overlayini degistirmez.
Bilinen spawn noktalari ve o anda gorulen yaratiklar ayri isaretlenir.
Kayitli koleksiyon canli tam liste gelene kadar son kayit olarak belirtilir.
Questlogun mevcut yerel pet kaydi yalniz okunur; oyuna veya Questloga yazilmaz.

OYUN ICI PET HARITASI (0.6.0)
Petler menusunde haritanin ustundeki Oyun icinde goster dugmesine bas.
420x420 pet haritasi karakterini merkezde takip eder; spawn ve canli pinler ayridir.
Baska pet icin dugmeye basinca ayni pencere secilen pete gecer.
Alt ile basligindan tasi; arti/eksi ile yakinlas, Gizle ile kapat.
Arayuz veya tepsi menusunden secili pet haritasini tekrar acabilirsin.
Pet haritasi ses uretmez; kup pencereleri bagimsiz calisir.
Pet basliginin yaninda mevcut ruhlar ve sonraki seviyeye kalan ruh gosterilir.
Seviye otomatik artar; oyun verisi guncellendiginde baslik da yenilenir.
3. seviye pet tamamlandi gosterilir.
'@
[IO.File]::AppendAllText((Join-Path $taskPackage 'ONCE-OKU.txt'),$taskGuideUpdate,(New-Object System.Text.UTF8Encoding($false)))

# New runtime modules must accompany both fresh and legacy overlay profiles.
foreach ($relative in @('src\history-store.mjs','src\combat-analytics.mjs','src\cube-proximity.mjs','src\map-position.mjs','src\world-map-catalog.mjs','data\combat-analytics.json','data\world-maps.json','public\workbench.js','public\cube-map.js','overlay\application-preload.cjs','overlay\cube-map-visibility.cjs')) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskPackage $relative) -PathType Leaf)) { throw "Required application file is missing: $relative" }
}
foreach($relative in @('src\pet-catalog.mjs','src\pet-map-catalog.mjs','src\pet-collection.mjs','src\pet-store.mjs','src\pet-tracker.mjs','src\pet-overlay-bridge.mjs','src\protocol\pets.mjs','overlay\pet-map-state.cjs','overlay\pet-progress.mjs','public\pets.js','public\pets-map.js','data\pets.json','data\pet-maps.json')) {
  if(-not(Test-Path -LiteralPath (Join-Path $taskPackage $relative) -PathType Leaf)){throw "Required pet file is missing: $relative"}
}

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
$taskAppVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskManifest = [ordered]@{name='kami-dps-meter-portable';version=$taskAppVersion;private=$true;type='module';engines=@{node='>=22'};dependencies=@{koffi=$taskKoffiVersion}}
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
Aion 2 world-map artwork belongs to NCSOFT. Public delivery: Questlog CDN.
Image sources, projection references and checksums: data/world-maps.json.
Reference map: https://questlog.gg/aion-2/en/map
The meter is an independent prototype and is not an official game client.

Npcap is not included. Download it separately from https://npcap.com/#download
"@
$taskNotices += "`nElectron/Chromium overlay runtime: version is pinned in overlay/runtime.json. Full license notices: runtime/electron/LICENSE and runtime/electron/LICENSES.chromium.html.`nSource: https://github.com/electron/electron/releases`n"
[IO.File]::WriteAllText((Join-Path $taskPackage 'THIRD-PARTY-NOTICES.txt'),$taskNotices,$taskUtf8)
$taskBuildInfo = [ordered]@{format='kami-portable/1';builtAt=[DateTime]::UtcNow.ToString('o');platform='win32-x64';node=$NodeVersion;koffi=$taskKoffiVersion;nodeArchiveSHA256=$taskActualNode;koffiArchiveSHA512=$taskActualKoffi;icons=$taskIcons.Count}
$taskBuildInfo.overlay = $true
$taskBuildInfo.appVersion = $taskAppVersion
[IO.File]::WriteAllText((Join-Path $taskPackage 'BUILD.json'),($taskBuildInfo | ConvertTo-Json),$taskUtf8)
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -Destination $taskPackage | Out-Host

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
