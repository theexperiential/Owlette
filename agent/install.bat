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

:: Install and start the Windows service
echo Installing and starting the Owlette Windows service...
cd %~dp0
cd src
"%PYTHON_PATH%" owlette_service.py install

:: Set the service to start automatically
sc config OwletteService start= delayed-auto

:: Start the service
"%PYTHON_PATH%" owlette_service.py start

:: Done
echo Installation complete!
endlocal
pause