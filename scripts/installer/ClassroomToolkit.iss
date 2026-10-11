#ifndef StageRoot
  #error StageRoot is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef OutputBaseFilename
  #error OutputBaseFilename is required
#endif

[Setup]
AppId={{8A00EBF1-1425-4C62-B97F-E0D3859AC884}
AppName=Classroom Answer Toolkit
AppVersion={#AppVersion}
AppPublisher=sciman-top
AppPublisherURL=https://github.com/sciman-top/classroom-answer-toolkit
AppSupportURL=https://github.com/sciman-top/classroom-answer-toolkit/issues
AppUpdatesURL=https://github.com/sciman-top/classroom-answer-toolkit/releases
DefaultDirName={localappdata}\Programs\ClassroomToolkit
DefaultGroupName=Classroom Answer Toolkit
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=yes
SetupLogging=yes
UninstallDisplayIcon={app}\ClassroomToolkit.App.exe
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName=Classroom Answer Toolkit
VersionInfoDescription=Classroom Answer Toolkit installer
VersionInfoCompany=sciman-top

[Files]
Source: "{#StageRoot}\*"; DestDir: "{app}"; Excludes: ".env"; Flags: ignoreversion recursesubdirs createallsubdirs
; The seeded .env is the teacher's configuration carrier: onlyifdoesntexist
; keeps an upgrade or repair from overwriting a configured key file, and
; uninsneveruninstall keeps it through an uninstall so a reinstall finds it.
Source: "{#StageRoot}\.env"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{autoprograms}\Classroom Answer Toolkit"; Filename: "{app}\ClassroomToolkit.App.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\ClassroomToolkit.App.exe"; Description: "Launch Classroom Answer Toolkit"; Flags: nowait postinstall skipifsilent
