@echo off
:: Check for admin rights and self-elevate if needed
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B
)

setlocal EnableDelayedExpansion
cd /d %~dp0

set "PYTHON_PATH=%ProgramFiles%\Python39\python.exe"
set "PYTHON_INSTALLER=%TEMP%\python-3.9.13-amd64.exe"

:: Check Python version from Registry
set PYTHON_INSTALLED=0
reg query "HKEY_LOCAL_MACHINE\SOFTWARE\Python\PythonCore\3.9\InstallPath" >nul 2>&1
if not errorlevel 1 (
    echo Python 3.9 is already installed.
    set PYTHON_INSTALLED=1
)

if %PYTHON_INSTALLED% EQU 0 (
    echo Python 3.9 is not installed. Downloading Python 3.9...
    
    :: Download Python 3.9 installer
    powershell -Command "(New-Object Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.9.13/python-3.9.13-amd64.exe', '%PYTHON_INSTALLER%')"
    
    :: Install Python with required features and add to PATH
    echo Installing Python 3.9...
    start /wait "" "%PYTHON_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 Include_pip=1
    
    :: Delete the installer
    del "%PYTHON_INSTALLER%"
    
    :: Wait for installation to complete
    echo Waiting for installation to complete...
    timeout /t 10 /nobreak > nul
)

:: Verify Python installation
if not exist "%PYTHON_PATH%" (
    echo Python installation failed. Please install Python 3.9 manually.
    pause
    exit /b 1
)

:: Stop the Owlette Windows service if it's running
echo Stopping the Owlette Windows service if it's running...
net stop OwletteService 2>nul

:: Install dependencies
echo Installing Python dependencies...
"%PYTHON_PATH%" -m pip install --upgrade pip
cd %~dp0
"%PYTHON_PATH%" -m pip install -r requirements.txt

:: Create necessary folder structure
mkdir "%~dp0logs" 2>nul
mkdir "%~dp0config" 2>nul
mkdir "%~dp0tmp" 2>nul

:: Create default config if it doesn't exist
if not exist "%~dp0config\config.json" (
    echo Creating default configuration...
    copy "%~dp0config.template.json" "%~dp0config\config.json" >nul
    echo Default config created: config\config.json
) else (
    echo Configuration already exists: config\config.json
)

:: Firebase setup (optional)
echo.
echo ================================================================
echo Firebase Cloud Integration Setup (OPTIONAL)
echo ================================================================
echo.
echo Firebase enables cloud features:
echo  - Remote monitoring and control
echo  - Real-time system metrics
echo  - Multi-site management
echo  - Web dashboard access
echo.
echo Owlette works perfectly fine WITHOUT Firebase!
echo You can add it later by re-running install.bat
echo.
choice /C YN /M "Do you want to set up Firebase now"
if errorlevel 2 goto skip_firebase
if errorlevel 1 goto setup_firebase

:setup_firebase
echo.
echo ----------------------------------------------------------------
echo Firebase Setup Instructions:
echo ----------------------------------------------------------------
echo 1. Go to: https://console.firebase.google.com/
echo 2. Create a project (or use existing)
echo 3. Go to Project Settings (gear icon) -^> Service Accounts
echo 4. Click "Generate new private key"
echo 5. Save the JSON file as: config\firebase-credentials.json
echo.
echo 6. Edit config\config.json and set:
echo    - "firebase.enabled": true
echo    - "firebase.site_id": "your-site-name"
echo.
echo For detailed setup guide, see: docs\phase1-firebase-setup.md
echo ----------------------------------------------------------------
echo.
echo After completing these steps, restart the Owlette service:
echo    net stop OwletteService
echo    net start OwletteService
echo.
pause
goto continue_install

:skip_firebase
echo.
echo Firebase setup skipped. Owlette will run in local-only mode.
echo You can enable Firebase later by:
echo  1. Following the Firebase setup guide in docs\phase1-firebase-setup.md
echo  2. Re-running install.bat
echo.

:continue_install
:: Install and start the Windows service
echo.
echo Installing and starting the Owlette Windows service...
cd %~dp0
cd src
"%PYTHON_PATH%" owlette_service.py install

:: Set the service to start automatically
sc config OwletteService start= delayed-auto

:: Start the service
"%PYTHON_PATH%" owlette_service.py start

:: Done
echo.
echo ================================================================
echo Installation complete!
echo ================================================================
echo.
echo Service: OwletteService (running)
echo Config: config\config.json
echo Logs: logs\service.log
echo.
if exist "%~dp0config\firebase-credentials.json" (
    echo Firebase: Enabled
) else (
    echo Firebase: Disabled (local-only mode)
)
echo.
echo To manage the service:
echo   net stop OwletteService
echo   net start OwletteService
echo.
endlocal
pause