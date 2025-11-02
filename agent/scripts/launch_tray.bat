@echo off
:: ============================================================================
:: Owlette Tray Icon Launcher
:: ============================================================================
:: Launches the Owlette system tray icon
:: ============================================================================

cd /d "%~dp0.."
set PYTHONPATH=%CD%\agent\src
start "" "%CD%\python\pythonw.exe" "%CD%\agent\src\owlette_tray.py"
