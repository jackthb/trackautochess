@echo off
cd /d "%~dp0.."
call app\backend\.venv\Scripts\activate
python tools\calibration.py %*
