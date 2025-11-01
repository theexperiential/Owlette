@echo off
setlocal enabledelayedexpansion

:: Change to the directory containing this script
cd /d "%~dp0"
echo Current directory: %CD%

echo Building Owlette Installer...

:: Clean old builds
echo Cleaning old builds...
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
rmdir /s /q installer 2>nul
mkdir installer 2>nul

:: Build Service
echo Building Service...
pyinstaller --clean ^
    --distpath dist ^
    --workpath build ^
    --noconfirm ^
    --hidden-import win32timezone ^
    --hidden-import win32ts ^
    --hidden-import win32serviceutil ^
    --hidden-import win32service ^
    --hidden-import win32event ^
    --hidden-import psutil ^
    --hidden-import firebase_client ^
    --hidden-import firebase_admin ^
    --hidden-import firebase_admin.firestore ^
    --hidden-import firebase_admin.credentials ^
    --hidden-import google.cloud ^
    --hidden-import google.cloud.firestore ^
    --hidden-import google.auth ^
    --hidden-import grpc ^
    --hidden-import google.api_core ^
    --collect-all win32com ^
    --collect-all pythoncom ^
    src\owlette_service.py || (
        echo Failed to build service executable
        pause
        exit /b 1
    )

:: Build GUI (using optimized spec file)
echo Building GUI...
pyinstaller --clean ^
    --distpath dist ^
    --workpath build ^
    --noconfirm ^
    owlette_gui.spec || (
        echo Failed to build GUI executable
        pause
        exit /b 1
    )

:: Build Tray
echo Building Tray...
pyinstaller --clean ^
    --distpath dist ^
    --workpath build ^
    --noconfirm ^
    --hidden-import win32timezone ^
    --hidden-import pystray._win32 ^
    --hidden-import psutil ^
    --collect-all win32com ^
    --noconsole ^
    src\owlette_tray.py || (
        echo Failed to build tray executable
        pause
        exit /b 1
    )

echo Creating installer...
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "owlette_setup.iss"
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    "C:\Program Files\Inno Setup 6\ISCC.exe" "owlette_setup.iss"
)

echo Build complete! Installer is in the installer directory.
pause