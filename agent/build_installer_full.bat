@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Owlette Embedded Python Installer Builder
:: ============================================================================
:: This script automates the creation of the embedded Python installer package
:: Run this script to build a complete installer from scratch
:: ============================================================================

echo.
echo ========================================
echo Owlette Embedded Installer Builder
echo ========================================
echo.

cd /d "%~dp0"

:: ============================================================================
:: Step 0: Read and validate VERSION file
:: ============================================================================
echo [0/9] Reading VERSION file...

if not exist "VERSION" (
    echo ERROR: VERSION file not found!
    pause
    exit /b 1
)
:: echo DEBUG: VERSION file exists

:: Read version from VERSION file
set /p OWLETTE_VERSION=<VERSION
:: echo DEBUG: Read result: [%OWLETTE_VERSION%]

:: Remove spaces
set OWLETTE_VERSION=%OWLETTE_VERSION: =%
:: echo DEBUG: After trim: [%OWLETTE_VERSION%]

if "%OWLETTE_VERSION%"=="" (
    echo ERROR: VERSION is empty after reading!
    pause
    exit /b 1
)

echo Building Owlette version: %OWLETTE_VERSION%
echo.

:: ============================================================================
:: Step 1: Clean previous builds
:: ============================================================================
echo [1/9] Cleaning previous builds...
if exist "build" (
    rmdir /s /q build 2>nul
)
mkdir build
mkdir build\installer_package

:: ============================================================================
:: Step 2: Download Python 3.11 embedded
:: ============================================================================
echo [2/9] Downloading Python 3.11 embedded...
if not exist "build\python-embed.zip" (
    echo Downloading Python 3.11.8 embedded...
    curl -L -o build\python-embed.zip https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip
    if errorlevel 1 (
        echo ERROR: Failed to download Python
        pause
        exit /b 1
    )
)

:: Extract Python
echo Extracting Python...
powershell -Command "Expand-Archive -Path build\python-embed.zip -DestinationPath build\python -Force"

:: ============================================================================
:: Step 3: Configure Python import paths
:: ============================================================================
echo [3/9] Configuring Python import paths...
(
    echo python311.zip
    echo .
    echo Lib
    echo Lib\site-packages
    echo ..\agent\src
    echo.
    echo # Enable site.main^(^) for pip support
    echo import site
) > build\python\python311._pth

:: ============================================================================
:: Step 4: Install pip
:: ============================================================================
echo [4/9] Installing pip...
curl -o build\get-pip.py https://bootstrap.pypa.io/get-pip.py
"%~dp0build\python\python.exe" "%~dp0build\get-pip.py"
if errorlevel 1 (
    echo ERROR: Failed to install pip
    pause
    exit /b 1
)
echo Pip installed successfully!

:: ============================================================================
:: Step 5: Install dependencies
:: ============================================================================
echo [5/9] Installing dependencies (this may take a few minutes)...
"%~dp0build\python\python.exe" -m pip install --no-warn-script-location --ignore-installed -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo Dependencies installed successfully!

:: ============================================================================
:: Step 6: Copy tkinter from system Python 3.11
:: ============================================================================
echo [6/9] Copying tkinter from system Python...
if exist "C:\Program Files\Python311" (
    echo Copying tkinter module...
    xcopy /E /I /Y "C:\Program Files\Python311\Lib\tkinter" build\python\Lib\tkinter\ >nul

    echo Copying tkinter DLLs...
    copy /Y "C:\Program Files\Python311\DLLs\_tkinter.pyd" build\python\ >nul
    copy /Y "C:\Program Files\Python311\DLLs\tcl86t.dll" build\python\ >nul
    copy /Y "C:\Program Files\Python311\DLLs\tk86t.dll" build\python\ >nul

    echo Copying tcl directory...
    xcopy /E /I /Y "C:\Program Files\Python311\tcl" build\python\tcl\ >nul
) else (
    echo WARNING: Python 3.11 not found at C:\Program Files\Python311
    echo GUI will not work without tkinter
    pause
)

:: ============================================================================
:: Step 7: Download NSSM
:: ============================================================================
echo [7/9] Downloading NSSM...
if not exist "build\nssm.zip" (
    echo Downloading NSSM 2.24...
    curl -L -o build\nssm.zip https://nssm.cc/release/nssm-2.24.zip
    if errorlevel 1 (
        echo ERROR: Failed to download NSSM
        pause
        exit /b 1
    )
)

:: Extract NSSM
echo Extracting NSSM...
powershell -Command "Expand-Archive -Path build\nssm.zip -DestinationPath build\nssm -Force"
mkdir build\tools 2>nul
copy /Y build\nssm\nssm-2.24\win64\nssm.exe build\tools\ >nul

:: ============================================================================
:: Step 8: Create installer package structure
:: ============================================================================
echo [8/9] Creating installer package...

:: Create directory structure
mkdir build\installer_package\python 2>nul
mkdir build\installer_package\agent\src 2>nul
mkdir build\installer_package\agent\icons 2>nul
mkdir build\installer_package\tools 2>nul
mkdir build\installer_package\scripts 2>nul

:: Note: config, logs, cache, tmp directories are now created in ProgramData by the installer

:: Copy Python runtime
echo Copying Python runtime...
xcopy /E /I /Y build\python\* build\installer_package\python\ >nul

:: Copy VERSION file (single source of truth for version management)
echo Copying VERSION file...
copy /Y VERSION build\installer_package\agent\ >nul

:: Copy agent source code
echo Copying agent source code...
xcopy /E /I /Y src\* build\installer_package\agent\src\ >nul

:: Note: Config template not needed - configure_site.py creates config in ProgramData during installation

:: Copy NSSM
echo Copying NSSM...
copy /Y build\tools\nssm.exe build\installer_package\tools\ >nul

:: Copy icons
if exist "icons" (
    echo Copying icons...
    xcopy /E /I /Y icons\* build\installer_package\agent\icons\ >nul
)

:: Copy installation scripts
echo Copying installation scripts...
copy /Y scripts\install.bat build\installer_package\scripts\ >nul
copy /Y scripts\uninstall.bat build\installer_package\scripts\ >nul
copy /Y scripts\launch_gui.bat build\installer_package\scripts\ >nul
copy /Y scripts\launch_tray.bat build\installer_package\scripts\ >nul

:: ============================================================================
:: Step 9: Optionally compile with Inno Setup
:: ============================================================================
echo.
echo [9/9] Checking for Inno Setup...

:: Check for Inno Setup
set "INNO_PATH=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "%INNO_PATH%" (
    echo Found Inno Setup! Creating installer.exe...
    mkdir build\installer_output 2>nul
    "%INNO_PATH%" owlette_installer.iss

    if errorlevel 1 (
        echo WARNING: Inno Setup compilation failed
        echo You can manually compile by running:
        echo   "%INNO_PATH%" owlette_installer.iss
    ) else (
        echo.
        echo ========================================
        echo SUCCESS! Installer Created!
        echo ========================================
        echo.
        echo Output: build\installer_output\Owlette-Installer-v%OWLETTE_VERSION%.exe
        echo.
    )
) else (
    echo Inno Setup not found
    echo.
    echo ========================================
    echo Build Complete!
    echo ========================================
    echo.
    echo Installer package created at: build\installer_package\
    echo.
    echo To create installer.exe, install Inno Setup 6 from:
    echo   https://jrsoftware.org/isdl.php
    echo.
    echo Then run manually:
    echo   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" owlette_installer.iss
    echo.
)

pause
