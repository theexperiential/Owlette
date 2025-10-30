@echo off
setlocal enabledelayedexpansion

:: Change to the directory containing this script
cd /d "%~dp0"
echo Current directory: %CD%

:: First, ensure pywin32 is properly installed
python -c "import win32timezone" 2>nul
if errorlevel 1 (
    echo Installing pywin32...
    pip uninstall -y pywin32 pypiwin32
    pip install --no-cache-dir pywin32
    python -m pip install --upgrade pip
    echo Running pywin32 post-install...
    python Scripts/pywin32_postinstall.py -install
)

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
    --collect-submodules win32com ^
    --collect-data win32com ^
    --collect-submodules win32api ^
    --collect-submodules win32con ^
    --collect-submodules win32gui ^
    --collect-submodules win32process ^
    --collect-submodules pythoncom ^
    src\owlette_service.py || (
        echo Failed to build service executable
        pause
        exit /b 1
    )

:: Build GUI
echo Building GUI...
pyinstaller --clean ^
    --distpath dist ^
    --workpath build ^
    --noconfirm ^
    --collect-submodules win32com ^
    --collect-data win32com ^
    --collect-submodules customtkinter ^
    --collect-submodules CTkListbox ^
    --collect-submodules CTkMessagebox ^
    --noconsole ^
    src\owlette_gui.py || (
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
    --collect-submodules win32com ^
    --collect-data win32com ^
    --collect-data pystray ^
    --collect-submodules pystray ^
    --noconsole ^
    src\owlette_tray.py || (
        echo Failed to build tray executable
        pause
        exit /b 1
    )

:: Verify the executables were created
if not exist "dist\owlette_service\owlette_service.exe" (
    echo Service executable not found
    pause
    exit /b 1
)

if not exist "dist\owlette_gui\owlette_gui.exe" (
    echo GUI executable not found
    pause
    exit /b 1
)

if not exist "dist\owlette_tray\owlette_tray.exe" (
    echo Tray executable not found
    pause
    exit /b 1
)

:: Create installer using Inno Setup
echo Creating installer with Inno Setup...
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "owlette_setup.iss"
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    "C:\Program Files\Inno Setup 6\ISCC.exe" "owlette_setup.iss"
) else (
    echo Error: Could not find Inno Setup Compiler
    pause
    exit /b 1
)

echo Build complete! Installer is in the installer directory.
pause