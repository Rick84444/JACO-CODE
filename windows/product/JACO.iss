; Native Windows setup, built on windows-latest with the exact verified payload.
; Build: ISCC.exe /DJacoVersion=0.22.0 /DPayloadDir=C:\...\payload /DOutputDir=C:\...\out JACO.iss
#ifndef JacoVersion
  #error JacoVersion is required
#endif
#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{C0C1956C-2D17-46D7-B2C0-EE2327745BE3}
AppName=JACO CODE
AppVerName=JACO CODE {#JacoVersion}
AppVersion={#JacoVersion}
AppPublisher=JACO CODE
AppPublisherURL=https://jacocode.com
AppSupportURL=https://github.com/Rick84444/JACO-CODE/issues
AppUpdatesURL=https://github.com/Rick84444/JACO-CODE/releases
DefaultDirName={autopf}\JACO CODE
DefaultGroupName=JACO CODE
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=JACO-Setup-{#JacoVersion}-win-x64
Compression=lzma2/fast
SolidCompression=no
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=JACO CODE
UsePreviousAppDir=yes
SetupLogging=yes
SetupIconFile={#PayloadDir}\JACO.ico
UninstallDisplayIcon={app}\JACO.ico
VersionInfoVersion={#JacoVersion}.0
; The Setup.exe does not request elevated permissions on JACO's behalf after installation.
; All running components are unelevated and keep their data in %LOCALAPPDATA%\JACO.

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: ".env,.git\*,logs\*,.jaco\*,*.log"
Source: "{#SourcePath}Start-JACO.ps1"; DestDir: "{app}\windows\product"; Flags: ignoreversion
Source: "{#SourcePath}JACO-launch.vbs"; DestDir: "{app}\windows\product"; Flags: ignoreversion
Source: "{#SourcePath}version.json"; DestDir: "{app}\windows\product"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\JACO CODE"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\product\JACO-launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\JACO.ico"; Comment: "Open JACO CODE and Aura"
Name: "{autodesktop}\JACO CODE"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\product\JACO-launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\JACO.ico"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\product\JACO-launch.vbs"""; Description: "Launch JACO CODE"; Flags: postinstall skipifsilent runasoriginaluser nowait
