@echo off
setlocal
cd /d %~dp0

:: Check for Python installation
where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed. Cannot proceed with uninstallation.
    goto :eof
)

:: Check Python version
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo %PYTHON_VERSION% | findstr /R "Python 3\..*" >nul
if errorlevel 1 (
    echo This script requires Python 3.x. Cannot proceed with uninstallation.
    goto :eof
)

:: Stop the Owlette Windows service if it's running
echo Stopping the Owlette Windows service if it's running...
net stop OwletteService

:: Close the Owlette Configuration window if it's open
echo Closing the Owlette Configuration window if it's running...
taskkill /F /FI "WINDOWTITLE eq Owlette Configuration"

:: Uninstall the Owlette Windows service
echo Uninstalling the Owlette Windows service...
cd %~dp0
cd src
python owlette_service.py remove

:: Optional: Ask the user if they want to remove Python dependencies
set /p uninstall_deps=Do you want to remove Python dependencies? (y/n):
if "%uninstall_deps%"=="y" (
    echo Uninstalling Python dependencies...
    cd %~dp0
    python -m pip uninstall -r requirements.txt -y
) else if "%uninstall_deps%"=="n" (
    echo Skipping Python dependency removal.
) else (
    echo Invalid choice. Skipping Python dependency removal.
)

:: Optional: Ask the user if they want to remove stored credentials
set /p remove_creds=Do you want to remove stored credentials (Slack and/or Gmail Tokens)? (y/n):
if "%remove_creds%"=="y" (
    echo Removing stored credentials...
    cd %~dp0
    cd src
    python remove_creds.py
) else if "%remove_creds%"=="n" (
    echo Skipping stored credential removal.
) else (
    echo Invalid choice. Skipping stored credential removal.
)

:: Done
echo Uninstallation complete!
endlocal

pause
