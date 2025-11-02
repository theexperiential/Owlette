@echo off
:: ============================================================================
:: Owlette GUI Launcher
:: ============================================================================
:: Launches the Owlette configuration GUI
:: ============================================================================

cd /d "%~dp0.."
set PYTHONPATH=%CD%\agent\src
start "" "%CD%\python\pythonw.exe" "%CD%\agent\src\owlette_gui.py"
