@echo off
:: Check for admin rights and self-elevate if needed
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B
)

echo ================================================================
echo Restarting Owlette Service
echo ================================================================
echo.

:: Stop the service
echo Stopping OwletteService...
net stop OwletteService

:: Wait a moment for clean shutdown
timeout /t 2 /nobreak > nul

:: Start the service
echo.
echo Starting OwletteService...
net start OwletteService

:: Check service status
echo.
echo Checking service status...
sc query OwletteService

echo.
echo ================================================================
echo Service restart complete!
echo ================================================================
echo.
echo Check logs at: C:\ProgramData\Owlette\logs\service.log
echo.
pause
