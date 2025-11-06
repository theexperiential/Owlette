@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Owlette Service Uninstallation Script
:: ============================================================================
:: This script uninstalls the Owlette Windows service
:: Run with administrator privileges
:: ============================================================================

echo.
echo ========================================
echo Owlette Service Uninstallation
echo ========================================
echo.

:: Get the installation directory
cd /d "%~dp0.."
set "INSTALL_DIR=%CD%"

:: ============================================================================
:: Check for administrator privileges
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script requires administrator privileges.
    echo Please run as administrator.
    echo.
    pause
    exit /b 1
)

:: ============================================================================
:: Stop and remove service
:: ============================================================================
echo Checking for Owlette service...
"%INSTALL_DIR%\tools\nssm.exe" status OwletteService >nul 2>&1

if %errorLevel% equ 0 (
    echo Stopping service...
    "%INSTALL_DIR%\tools\nssm.exe" stop OwletteService

    :: Wait up to 10 seconds for service to stop gracefully
    :: This allows the service to cleanly set online=false in Firestore
    echo Waiting for service to stop gracefully...
    set WAIT_COUNT=0
    :WAIT_LOOP
    "%INSTALL_DIR%\tools\nssm.exe" status OwletteService | findstr /C:"SERVICE_STOPPED" >nul 2>&1
    if !errorLevel! equ 0 goto SERVICE_STOPPED

    timeout /t 1 /nobreak >nul
    set /a WAIT_COUNT+=1
    if !WAIT_COUNT! lss 10 goto WAIT_LOOP

    :: If service didn't stop after 10 seconds, force stop
    echo Service did not stop gracefully, forcing...
    "%INSTALL_DIR%\tools\nssm.exe" stop OwletteService
    timeout /t 1 /nobreak >nul

    :SERVICE_STOPPED
    echo Service stopped successfully

    :: SAFETY MARGIN: Wait additional 3 seconds for Firestore sync
    echo Waiting for Firestore sync to complete...
    timeout /t 3 /nobreak >nul

    echo Removing service...
    "%INSTALL_DIR%\tools\nssm.exe" remove OwletteService confirm

    if %errorLevel% equ 0 (
        echo.
        echo ========================================
        echo Service Uninstalled Successfully
        echo ========================================
        echo.
    ) else (
        echo ERROR: Failed to remove service
        pause
        exit /b 1
    )
) else (
    echo Service not found. Already uninstalled?
)

echo.
echo Note: Configuration and logs have been preserved.
echo To completely remove Owlette, delete the installation directory:
echo   %INSTALL_DIR%
echo.
pause
