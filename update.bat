@echo off
rem Double-click to update narai-storefct: pull main, build, restart NaraiStorefctWeb.
rem Asks for Administrator rights (UAC) by itself, then runs scripts\update.ps1.

net session >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath %~f0 -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"

echo.
pause
