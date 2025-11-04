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
:: Step 2: Create ProgramData directories for config and logs
:: ============================================================================
echo [1/4] Creating ProgramData directories...
set "DATA_DIR=%ProgramData%\Owlette"

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\config" mkdir "%DATA_DIR%\config"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
if not exist "%DATA_DIR%\cache" mkdir "%DATA_DIR%\cache"
if not exist "%DATA_DIR%\tmp" mkdir "%DATA_DIR%\tmp"

echo ProgramData directories created at: %DATA_DIR%

:: Note: Config file will be created by configure_site.py during first run or OAuth setup

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

"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppStdout "%DATA_DIR%\logs\service_stdout.log"
"%INSTALL_DIR%\tools\nssm.exe" set OwletteService AppStderr "%DATA_DIR%\logs\service_stderr.log"
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
    echo Check logs at: %DATA_DIR%\logs\
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
echo Config: %DATA_DIR%\config\
echo Logs: %DATA_DIR%\logs\
echo.
echo You can manage the service from:
echo   - Services.msc (Windows Services)
echo   - Task Manager ^> Services tab
echo.
if "%SILENT_MODE%"=="0" pause
