@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo Current directory: %CD%
echo.

if exist VERSION (
    echo VERSION file exists
) else (
    echo VERSION file DOES NOT exist
)
echo.

echo Attempting to read VERSION file...
set /p OWLETTE_VERSION=<VERSION
echo Version read: !OWLETTE_VERSION!
echo.

pause
