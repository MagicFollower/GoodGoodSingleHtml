@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.." || (echo FAIL cannot reach project root & pause & exit /b 1)
rem ASCII-only file. The kill filter inside stop-dev.ps1 matches process image paths
rem under this project directory only - it never touches other Electron apps.

echo [*] stopping dev processes started from this project
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "bin\stop-dev.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo !! stop-dev.ps1 exited with code %RC%
pause
exit /b %RC%
