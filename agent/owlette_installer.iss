; Owlette Installer Script for Inno Setup
; ============================================================================
; This script creates a professional Windows installer for Owlette
; Requires: Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
; ============================================================================
;
; AUTHENTICATION:
; ---------------
; This installer uses OAuth custom token authentication (no service accounts).
; During installation, the user is prompted to authenticate via their browser.
; The agent receives OAuth tokens which are stored securely in Windows
; Credential Manager (encrypted, machine + user specific).
;
; OAUTH FLOW:
; -----------
; 1. Installer runs configure_site.py (opens browser to owlette.app/setup)
; 2. User logs in and selects/creates a site
; 3. Web backend generates registration code (single-use, 24h expiry)
; 4. Browser sends callback to http://localhost:8765 with site_id + code
; 5. configure_site.py exchanges code for access token + refresh token
; 6. Tokens stored in Windows Credential Manager (not in config files)
; 7. Agent uses tokens to authenticate with Firestore REST API
;
; SECURITY:
; ---------
; - No service accounts required (eliminated firebase-credentials.json)
; - Tokens are user-scoped (tied to user's account)
; - Tokens can be revoked via web dashboard ("Remove Machine" button)
; - Access token: 1 hour expiry (auto-refreshes)
; - Refresh token: 30 days expiry (stored encrypted)
;
; BUILD PARAMETERS:
; -----------------
; /SERVER=dev   → Uses dev.owlette.app (default)
; /SERVER=prod  → Uses owlette.app (production)
;
; Example:
;   Owlette-Installer-v2.0.0.exe /SERVER=prod
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
OutputBaseFilename=Owlette-Installer-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\agent\icons\normal.png
SetupIconFile=icons\normal.ico
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
FinishedLabel=Setup has finished installing [name] on your computer.%n%nThe Owlette service and tray icon will start automatically within a few moments. Look for the Owlette icon (a dot in a circle) in your taskbar—it may be hidden under the overflow menu (^).

[Tasks]
; Desktop icons removed - tray icon auto-starts on login via startup folder

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

; Startup shortcut (always installed - important for monitoring UX)
Name: "{userstartup}\Owlette Tray"; Filename: "{app}\scripts\launch_tray.bat"; IconFilename: "{app}\agent\icons\normal.png"; WorkingDir: "{app}"

[Run]
; Step 1: Configure site (browser-based OAuth flow) - RUNS FIRST
; Pass server URL based on /SERVER= command-line parameter
; Usage: Owlette-Installer-v2.0.0.exe              (uses owlette.app, default)
;        Owlette-Installer-v2.0.0.exe /SERVER=prod (uses owlette.app)
;        Owlette-Installer-v2.0.0.exe /SERVER=dev  (uses dev.owlette.app for testing)
Filename: "{app}\python\python.exe"; Parameters: """{app}\agent\src\configure_site.py"" --url ""{code:GetServerEnvironment}"""; Description: "Configure Owlette site"; StatusMsg: "Opening browser for site configuration..."; Flags: waituntilterminated

; Step 2: Install and start the Windows service - RUNS SECOND (only after configuration completes)
Filename: "{app}\scripts\install.bat"; Parameters: "--silent"; Description: "Install Owlette service"; StatusMsg: "Installing Owlette service..."; Flags: runhidden waituntilterminated

; Note: Tray icon launches automatically on login via startup folder (see [Icons] section above)
; No need to launch it here - it will start on next login or can be launched manually from Start Menu

[UninstallRun]
; Stop and remove the Windows service before uninstalling
Filename: "{app}\tools\nssm.exe"; Parameters: "stop OwletteService"; Flags: runhidden waituntilterminated
Filename: "{app}\tools\nssm.exe"; Parameters: "remove OwletteService confirm"; Flags: runhidden waituntilterminated

[Code]
var
  ConfigBackupPath: String;
  DidUninstallExisting: Boolean;

function GetServerEnvironment(Param: String): String;
var
  ServerParam: String;
begin
  // Get SERVER parameter from command line (e.g., /SERVER=prod or /SERVER=dev)
  ServerParam := ExpandConstant('{param:SERVER|prod}');  // Default to 'prod'

  if ServerParam = 'dev' then
    Result := 'https://dev.owlette.app/setup'
  else
    Result := 'https://owlette.app/setup';  // Default to production

  Log('Server environment: ' + ServerParam + ' -> ' + Result);
end;

procedure BackupConfigIfExists;
var
  ConfigPath: String;
begin
  ConfigPath := ExpandConstant('{app}\agent\config\config.json');

  if FileExists(ConfigPath) then
  begin
    ConfigBackupPath := ExpandConstant('{tmp}\config.json.backup');
    FileCopy(ConfigPath, ConfigBackupPath, False);
    Log('Backed up config to: ' + ConfigBackupPath);
  end;
end;

procedure RestoreConfigIfBackedUp;
var
  ConfigPath: String;
begin
  // Don't restore backup - let OAuth setup create the new config
  // The backup would overwrite the OAuth setup's changes (enabled=true, project_id, api_base)
  // Users can manually restore their old processes array after installation if needed
  if ConfigBackupPath <> '' then
  begin
    if FileExists(ConfigBackupPath) then
    begin
      Log('Config backup available at: ' + ConfigBackupPath);
      Log('Not restoring to allow OAuth setup to configure Firebase settings');
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    // Backup config before installation
    BackupConfigIfExists;
  end
  else if CurStep = ssPostInstall then
  begin
    // Restore config after installation
    RestoreConfigIfBackedUp;
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
  UninstallString: String;
  UninstallExe: String;
begin
  Result := True;
  DidUninstallExisting := False;  // Initialize flag

  // Check if running as admin
  if not IsAdmin then
  begin
    MsgBox('This installer requires administrator privileges to install the Windows service.' + #13#10 +
           'Please right-click the installer and select "Run as administrator".',
           mbError, MB_OK);
    Result := False;
    Exit;
  end;

  // Check for existing installation
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A7B8C9D0-E1F2-4A5B-8C9D-0E1F2A3B4C5D}_is1', 'UninstallString', UninstallString) then
  begin
    if MsgBox('An existing Owlette installation was detected.' + #13#10#13#10 +
              'Your configuration will be preserved, but the installer needs to uninstall the old version first.' + #13#10#13#10 +
              'Click OK to uninstall and continue, or Cancel to exit.',
              mbConfirmation, MB_OKCANCEL) = IDOK then
    begin
      // Extract the uninstaller path (remove /SILENT flag if present)
      UninstallExe := RemoveQuotes(UninstallString);

      // Stop the service first (if NSSM exists)
      if FileExists('C:\Owlette\tools\nssm.exe') then
      begin
        Exec('C:\Owlette\tools\nssm.exe', 'stop OwletteService', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Sleep(2000);
      end;

      // Run uninstaller silently
      if Exec(UninstallExe, '/SILENT /NORESTART /SUPPRESSMSGBOXES', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      begin
        Log('Previous installation uninstalled successfully');
        DidUninstallExisting := True;  // Track that we handled uninstall
        Sleep(3000);  // Give Windows time to clean up
      end
      else
      begin
        MsgBox('Failed to uninstall the existing version. Please uninstall manually and try again.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
    end
    else
    begin
      Result := False;
      Exit;
    end;
  end;

  // Only warn about running processes if we didn't just uninstall
  // (uninstall already stopped the service and closed processes)
  if not DidUninstallExisting then
  begin
    if MsgBox('The installer will close any running Owlette GUI or tray icon windows.' + #13#10#13#10 +
              'The Windows service will be restarted automatically after installation.' + #13#10#13#10 +
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
end;
