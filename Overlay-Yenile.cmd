@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-overlay.ps1"
if errorlevel 1 pause
