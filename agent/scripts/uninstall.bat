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
