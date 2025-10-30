#define MyAppName "Owlette"
#define MyAppVersion "0.4.2"
#define MyAppPublisher "The Experiential"
#define MyAppURL "https://github.com/theexperiential/Owlette"
#define MyAppExeName "owlette_gui.exe"

[Setup]
AppId={{E8F5D8A2-3F4E-4C1D-9E4F-8D8F7F8D8F7F}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
PrivilegesRequired=admin
OutputDir=installer
OutputBaseFilename=owlette_setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Start Owlette at system startup"; GroupDescription: "Windows Service:"; Flags: unchecked

[Files]
Source: "dist\owlette_gui\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\owlette_service\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\owlette_tray\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\logs"; Permissions: everyone-full
Name: "{app}\config"; Permissions: everyone-full
Name: "{app}\tmp"; Permissions: everyone-full

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Create initial config file if it doesn't exist
Filename: "cmd.exe"; Parameters: "/c echo {{""version"": ""1.3.0"", ""processes"": [], ""gmail"": {{""enabled"": false, ""to"": []}}, ""slack"": {{""enabled"": false}}}} > ""{app}\config\config.json"""; \
    Flags: runhidden; StatusMsg: "Creating initial configuration..."

; Stop any existing service
Filename: "net.exe"; Parameters: "stop OwletteService"; Flags: runhidden; StatusMsg: "Stopping existing service..."

; Remove any existing service
Filename: "cmd.exe"; Parameters: "/c sc delete OwletteService > ""{app}\logs\service_install.log"" 2>&1"; Flags: runhidden; StatusMsg: "Removing existing service..."

; Install new service with logging
Filename: "python.exe"; Parameters: """{app}\owlette_service.exe"" install > ""{app}\logs\service_install.log"" 2>&1"; \
    Flags: runhidden waituntilterminated; StatusMsg: "Installing Owlette service..."

; Configure service startup
Filename: "sc.exe"; Parameters: "config OwletteService start= delayed-auto >> ""{app}\logs\service_install.log"" 2>&1"; \
    Flags: runhidden waituntilterminated; Tasks: startupicon

; Start the service with logging
Filename: "net.exe"; Parameters: "start OwletteService >> ""{app}\logs\service_install.log"" 2>&1"; \
    Flags: runhidden waituntilterminated; Tasks: startupicon; StatusMsg: "Starting Owlette service..."

[UninstallRun]
Filename: "net.exe"; Parameters: "stop OwletteService"; Flags: runhidden waituntilterminated
Filename: "cmd.exe"; Parameters: "/c sc delete OwletteService"; Flags: runhidden waituntilterminated

[Code]
var
  ResultCode: Integer;

[UninstallDelete]
Type: filesandordirs; Name: "{app}"