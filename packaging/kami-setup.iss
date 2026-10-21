#ifndef AppVersion
  #define AppVersion "0.7.0"
#endif
#ifndef AppName
  #define AppName "Kami DPS Meter"
#endif
#ifndef AppId
  #define AppId "KamiDPSMeter"
#endif
#ifndef BackendPort
  #define BackendPort "4317"
#endif
#ifndef PayloadDir
  #error PayloadDir must point to a verified clean application staging directory.
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef OutputBase
  #define OutputBase "Kami-DPS-Meter-Setup-" + AppVersion
#endif
[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Kami
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBase}
SetupIconFile=assets\launcher.ico
UninstallDisplayIcon={app}\Kami DPS Meter.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=no
RestartApplications=no
UsePreviousTasks=yes
SetupLogging=yes
[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Masaüstüne kısayol oluştur"; GroupDescription: "Kısayollar:"
Name: "startup"; Description: "Windows açılışında başlat (tepsi ve oyun üstü pencereler)"; GroupDescription: "Başlatma:"; Flags: unchecked
Name: "importportable"; Description: "Mevcut taşınabilir Kami klasöründen verileri içe aktar"; GroupDescription: "Veriler (isteğe bağlı):"; Flags: unchecked checkedonce
[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\Kami DPS Meter.exe"; Parameters: "--port={#BackendPort}"; WorkingDir: "{app}"; IconFilename: "{app}\Kami DPS Meter.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Kami DPS Meter.exe"; Parameters: "--port={#BackendPort}"; WorkingDir: "{app}"; IconFilename: "{app}\Kami DPS Meter.exe"; Tasks: desktopicon
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\Kami DPS Meter.exe"" --startup --port={#BackendPort}"; Tasks: startup; Flags: uninsdeletevalue
[Run]
Filename: "{app}\Kami DPS Meter.exe"; Parameters: "--port={#BackendPort}"; Description: "Kami DPS Meter uygulamasını aç"; Flags: postinstall nowait skipifsilent
[UninstallDelete]
Type: files; Name: "{app}\installed.json"
[Code]
var PortablePage: TInputDirWizardPage;
procedure InitializeWizard();
begin
  PortablePage := CreateInputDirPage(wpSelectTasks, 'Taşınabilir verileri içe aktar', 'Eski klasör korunur; kaynakta değişiklik yapılmaz.', 'Yalnız seçtiğiniz Kami klasöründeki yerel kayıt ve ayarlar içe aktarılır. Bu adım isteğe bağlıdır.', False, '');
  PortablePage.Add('Taşınabilir Kami klasörü:');
  PortablePage.Values[0] := ExpandConstant('{param:PORTABLESOURCE|}');
end;
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = PortablePage.ID) and not WizardIsTaskSelected('importportable');
end;
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = PortablePage.ID) and WizardIsTaskSelected('importportable') then begin
    Result := DirExists(PortablePage.Values[0]) and FileExists(AddBackslash(PortablePage.Values[0]) + 'package.json') and (PortablePage.Values[0] <> ExpandConstant('{app}'));
    if not Result then MsgBox('Geçerli eski taşınabilir Kami klasörünü seçin.', mbError, MB_OK);
  end;
end;
function StopInstalledApplication(): Boolean;
var ResultCode: Integer; MarkerText: AnsiString;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\installed.json')) then begin
    if not LoadStringFromFile(ExpandConstant('{app}\installed.json'), MarkerText) or (Pos('"format":"kami-installed/1"', MarkerText) = 0) then begin Result := False; Exit; end;
  end;
  if FileExists(ExpandConstant('{app}\Kami DPS Meter.exe')) and FileExists(ExpandConstant('{app}\installed.json')) then
    Result := Exec(ExpandConstant('{app}\Kami DPS Meter.exe'), '--stop --quiet --port={#BackendPort}', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if WizardIsTaskSelected('importportable') then begin
    if (Trim(PortablePage.Values[0]) = '') or not DirExists(PortablePage.Values[0]) or not FileExists(AddBackslash(PortablePage.Values[0]) + 'package.json') then begin Result := 'İçe aktarma için geçerli taşınabilir Kami klasörü seçilmedi.'; Exit; end;
  end;
  if FileExists(ExpandConstant('{app}\package.json')) and not FileExists(ExpandConstant('{app}\installed.json')) then begin Result := 'Bu klasör kurulu Kami uygulamasına ait değil. Taşınabilir klasörü korumak için farklı bir kurulum klasörü seçin.'; Exit; end;
  if not StopInstalledApplication() then Result := 'Kami kapatılamadı. Tepsi menüsünden Tamamen kapat seçeneğini kullanıp kurulumu yeniden deneyin.';
end;
function InitializeUninstall(): Boolean;
begin
  Result := StopInstalledApplication();
  if not Result then SuppressibleMsgBox('Kami kapatılamadı. Uygulama dosyaları silinmedi. Tepsi menüsünden Tamamen kapat seçeneğini kullanıp yeniden deneyin.', mbError, MB_OK, IDOK);
end;
procedure CurStepChanged(CurStep: TSetupStep);
var ResultCode: Integer; Arguments: String;
begin
  if CurStep = ssPostInstall then begin
    SaveStringToFile(ExpandConstant('{app}\installed.json'), '{"format":"kami-installed/1","version":"{#AppVersion}","port":{#BackendPort}}', False);
    if not WizardIsTaskSelected('startup') then RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#AppName}');
    if WizardIsTaskSelected('importportable') then begin
      Arguments := '"' + ExpandConstant('{app}\overlay\runtime-paths.cjs') + '" --seed-portable="' + PortablePage.Values[0] + '"';
      if not Exec(ExpandConstant('{app}\runtime\node.exe'), Arguments, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
        SuppressibleMsgBox('Uygulama kuruldu, ancak eski veriler içe aktarılamadı. Eski klasör değiştirilmedi.', mbError, MB_OK, IDOK);
    end;
  end;
end;
