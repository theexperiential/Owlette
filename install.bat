@echo off
:: Check for admin rights and self-elevate if needed
net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

setlocal
cd /d %~dp0

:: Check for Python installation
where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed. Please install Python 3.x and rerun this script.
    pause
    goto :eof
)

:: Check Python version
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo %PYTHON_VERSION% | findstr /R "Python 3\..*" >nul
if errorlevel 1 (
    echo This script requires Python 3.x. Please install the correct version and rerun this script.
    pause
    goto :eof
)

:: Stop the Owlette Windows service if it's running
echo Stopping the Owlette Windows service if it's running...
net stop OwletteService

:: Install dependencies
echo Installing Python dependencies...
python -m pip install --upgrade pip
cd %~dp0
python -m pip install -r requirements.txt

:: Create necessary folder structure
mkdir "%~dp0logs" 2>nul
mkdir "%~dp0config" 2>nul
mkdir "%~dp0tmp" 2>nul

:: Install and start the Windows service
echo Installing and starting the Owlette Windows service...
cd %~dp0
cd src
python owlette_service.py install

:: Set the service to start automatically
sc config OwletteService start= delayed-auto

:: Start the service
python owlette_service.py start

:: Done
echo Installation complete!
endlocal
pause