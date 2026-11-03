; packaging/windows/choreo.iss — 윈도우 설치 파일(Inno Setup 6). packaging/build.py 가 /D 로 값을 넘겨 부른다.
;
; ⚠ 사용자의 것(영상 · 안무표 · 설정)은 %LOCALAPPDATA% · %APPDATA% 의 choreo 폴더에 있고 이 설치가 만들지도
;   지우지도 않는다 — 앱을 지워도 안무표는 남는다(server.py 의 data_home · config_home).
; ⚠ 서명하지 않는다(결정 2026-10-13: 첫 판은 서명 없이) — SmartScreen 경고 넘기는 법은 packaging/README.md.

#ifndef AppName
  #define AppName "SwingChoreo"
#endif

[Setup]
AppId={{6E7F1D3A-5C2B-4B8E-9A61-2D0C4F7B9E15}
AppName={#DisplayName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#DisplayName}
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename={#AppName}-{#AppVersion}-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppName}.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#DisplayName}"; Filename: "{app}\{#AppName}.exe"
Name: "{userdesktop}\{#DisplayName}"; Filename: "{app}\{#AppName}.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "바탕 화면에 바로 가기 만들기"; Flags: unchecked

[Run]
Filename: "{app}\{#AppName}.exe"; Description: "{#DisplayName} 켜기"; Flags: nowait postinstall skipifsilent
