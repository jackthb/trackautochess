@echo off
cd /d "%~dp0"
echo Building DACTracker...
echo.
pyinstaller dac_tracker.spec 2>&1
echo.
if errorlevel 1 (
    echo ===============================
    echo BUILD FAILED - see errors above
    echo ===============================
) else (
    echo ===============================
    echo BUILD OK - dist\DACTracker.exe
    echo ===============================
)
echo.
pause
