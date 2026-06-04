@echo off
setlocal

cd /d "%~dp0"

echo Starting Dota FPS capture with PresentMon...
echo.
echo Scenario: dac-active
echo Duration:  15 minutes
echo Output:    presentmon-runs\
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\capture-dota-fps.ps1" -Scenario dac-active -Seconds 900

echo.
echo Done. Press any key to close this window.
pause >nul
