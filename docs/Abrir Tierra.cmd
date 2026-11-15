@echo off
cd /d "%~dp0"
python iniciar.py --tierra
if errorlevel 1 pause
