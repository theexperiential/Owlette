@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Owlette Service Installation Script
:: ============================================================================
:: This script installs Owlette as a Windows service using NSSM
:: Run with administrator privileges
:: Usage: install.bat [--silent]  (--silent skips pauses for installer)
:: ============================================================================

:: Check for silent mode (when run from Inno Setup installer)
set "SILENT_MODE=0"
if /i "%~1"=="--silent" set "SILENT_MODE=1"

echo.
echo ========================================
echo Owlette Service Installation
echo ========================================
echo.

:: Get the installation directory (where this script is located)
cd /d "%~dp0.."
set "INSTALL_DIR=%CD%"

echo Installation directory: %INSTALL_DIR%
echo.

:: ============================================================================
:: Step 1: Check for administrator privileges
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script requires administrator privileges.
    echo Please run as administrator.
    echo.
    if "%SILENT_MODE%"=="0" pause
    exit /b 1
)

:: ============================================================================
:: Step 2: Create config file if it doesn't exist
:: ============================================================================
echo [1/4] Creating configuration...
if not exist "%INSTALL_DIR%\agent\config\config.json" (
    echo Creating config.json from template...
    copy "%INSTALL_DIR%\agent\config\config.template.json" "%INSTALL_DIR%\agent\config\config.json"
) else (
    echo Config file already exists, skipping...
)

:: Create logs and tmp directories
if not exist "%INSTALL_DIR%\agent\logs" (
    mkdir "%INSTALL_DIR%\agent\logs"
)
if not exist "%INSTALL_DIR%\agent\tmp" (
    mkdir "%INSTALL_DIR%\agent\tmp"
)

:: ============================================================================
:: Step 3: Stop and remove existing service (if any)
:: ============================================================================
echo [2/4] Checking for existing service...
"%INSTALL_DIR%\tools\nssm.exe" status OwletteService >nul 2>&1
if %errorLevel% equ 0 (
    echo Stopping existing service...
    "%INSTALL_DIR%\tools\nssm.exe" stop OwletteService
    timeout /t 2 /nobreak >nul

    echo Removing existing service...
    "%INSTALL_DIR%\tools\nssm.exe" remove OwletteService confirm
)

:: ============================================================================
:: Step 4: Install service with NSSM
:: ============================================================================
echo [3/4] Installing Owlette service...

:: Install service with application and script (no spaces in C:\Owlette path)
"%INSTALL_DIR%\tools\nssm.exe" install OwletteService "%INSTALL_DIR%\python\pythonw.exe" "%INSTALL_DIR%\agent\src\owlette_runner.py"

if %errorLevel% neq 0 (
    echo ERROR: Failed to install service
    if "%SILENT_MODE%"=="0" pause
    exit /b 1
)

:: Configure service
echo Configuring service...
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppDirectory "%INSTALL_DIR%\agent\src"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService DisplayName "Owlette Service"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService Description "Owlette process monitoring and management service"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService Start SERVICE_AUTO_START

:: CRITICAL: Run service as logged-in user so OAuth tokens in Windows Credential Manager are accessible
echo Configuring service to run as current user...
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService ObjectName ".\%USERNAME%"

"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppStdout "%INSTALL_DIR%\agent\logs\service_stdout.log"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppStderr "%INSTALL_DIR%\agent\logs\service_stderr.log"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppRotateFiles 1
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppRotateOnline 1
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppRotateSeconds 86400
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppRotateBytes 10485760

:: Set service dependencies (wait for network)
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService DependOnService Tcpip Dnscache

:: ============================================================================
:: Step 5: Start service
:: ============================================================================
echo [4/4] Starting service...
"%INSTALL_DIR%\tools\nssm.exe" start OwletteService

if %errorLevel% neq 0 (
    echo ERROR: Failed to start service
    echo Check logs at: %INSTALL_DIR%\agent\logs\
    if "%SILENT_MODE%"=="0" pause
    exit /b 1
)

:: Wait a moment and check status
timeout /t 3 /nobreak >nul
"%INSTALL_DIR%\tools\nssm.exe" status OwletteService

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Service: OwletteService
echo Status: Running
echo Logs: %INSTALL_DIR%\agent\logs\
echo.
echo You can manage the service from:
echo   - Services.msc (Windows Services)
echo   - Task Manager ^> Services tab
echo.
if "%SILENT_MODE%"=="0" pause
