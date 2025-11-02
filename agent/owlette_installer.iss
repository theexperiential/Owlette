; Owlette Installer Script for Inno Setup
; ============================================================================
; This script creates a professional Windows installer for Owlette
; Requires: Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
; ============================================================================

#define MyAppName "Owlette"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Owlette Project"
#define MyAppURL "https://github.com/yourusername/owlette"
#define MyAppExeName "pythonw.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
; Do not use the same AppId value in installers for other applications.
AppId={{A7B8C9D0-E1F2-4A5B-8C9D-0E1F2A3B4C5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=build\installer_output
OutputBaseFilename=Owlette-Setup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\agent\icons\normal.png
; SetupIconFile=icons\normal.ico  ; TODO: Create .ico file for installer icon
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Python runtime
Source: "build\installer_package\python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs

; Agent source code
Source: "build\installer_package\agent\*"; DestDir: "{app}\agent"; Flags: ignoreversion recursesubdirs createallsubdirs

; Tools (NSSM)
Source: "build\installer_package\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion

; Scripts
Source: "build\installer_package\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion

; README and documentation
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start Menu shortcuts
Name: "{group}\Owlette Configuration"; Filename: "{app}\scripts\launch_gui.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"
Name: "{group}\Owlette Tray Icon"; Filename: "{app}\scripts\launch_tray.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"
Name: "{group}\View Logs"; Filename: "{app}\agent\logs"; IconFilename: "{sys}\shell32.dll"; IconIndex: 4
Name: "{group}\Edit Configuration"; Filename: "{app}\agent\config\config.json"; IconFilename: "{sys}\shell32.dll"; IconIndex: 70
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Desktop shortcuts (optional)
Name: "{autodesktop}\Owlette Configuration"; Filename: "{app}\scripts\launch_gui.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autodesktop}\Owlette Tray Icon"; Filename: "{app}\scripts\launch_tray.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"; Tasks: desktopicon

; Startup shortcut (always installed - important for monitoring UX)
Name: "{userstartup}\Owlette Tray"; Filename: "{app}\scripts\launch_tray.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"

[Run]
; Step 1: Configure site (browser-based OAuth flow) - RUNS FIRST
Filename: "{app}\python\python.exe"; Parameters: """{app}\agent\src\configure_site.py"""; Description: "Configure Owlette site"; StatusMsg: "Opening browser for site configuration..."; Flags: runhidden waituntilterminated

; Step 2: Install and start the Windows service - RUNS SECOND (only after configuration completes)
Filename: "{app}\scripts\install.bat"; Parameters: "--silent"; Description: "Install Owlette service"; StatusMsg: "Installing Owlette service..."; Flags: runhidden waituntilterminated

; Step 3: Optionally launch tray icon after install - RUNS LAST
Filename: "{app}\scripts\launch_tray.bat"; Description: "Launch Owlette tray icon"; Flags: nowait postinstall skipifsilent unchecked

[UninstallRun]
; Stop and remove the Windows service before uninstalling
Filename: "{app}\tools\nssm.exe"; Parameters: "stop OwletteService"; Flags: runhidden waituntilterminated
Filename: "{app}\tools\nssm.exe"; Parameters: "remove OwletteService confirm"; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Log installation complete
    Log('Owlette installation completed successfully');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    // Log uninstallation
    Log('Uninstalling Owlette...');
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;

  // Check if running as admin
  if not IsAdmin then
  begin
    MsgBox('This installer requires administrator privileges to install the Windows service.' + #13#10 +
           'Please right-click the installer and select "Run as administrator".',
           mbError, MB_OK);
    Result := False;
    Exit;
  end;

  // Warn about running processes and close them
  if MsgBox('The installer will close any running Owlette GUI or tray icon windows.' + #13#10#13#10 +
            'The Windows service will be restarted automatically.' + #13#10#13#10 +
            'Click OK to continue.',
            mbInformation, MB_OKCANCEL) = IDCANCEL then
  begin
    Result := False;
    Exit;
  end;

  // Try to close GUI and tray icon processes
  Exec('taskkill', '/F /IM pythonw.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/F /IM python.exe /FI "WINDOWTITLE eq OWLETTE*"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Wait a moment for processes to close
  Sleep(2000);
end;
