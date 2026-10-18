@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.." || (echo FAIL cannot reach project root & pause & exit /b 1)
rem ASCII-only file, no bare redirect chars in echo payloads, no goto inside blocks.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "bin\electron-win-build.ps1" -Target nsis %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo !! build failed, exit code %RC%
  pause
  exit /b %RC%
)

set "N=0"
for %%F in ("release\*_setup.exe") do set /a N+=1
if "%N%"=="0" (
  echo FAIL no *_setup.exe under release\
  pause
  exit /b 1
)
echo [*] found %N% installer(s)
for %%F in ("release\*_setup.exe") do echo     %%~nxF   %%~zF bytes   modified %%~tF
pause
exit /b 0
