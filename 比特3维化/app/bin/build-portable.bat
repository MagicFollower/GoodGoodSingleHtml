@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.." || (echo FAIL cannot reach project root & pause & exit /b 1)
rem ASCII-only file. Portable exe unpacks itself to temp on every launch, so it starts
rem roughly an order of magnitude slower than the win-unpacked directory build, and its
rem child process stdout does not bubble up to this console.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "bin\electron-win-build.ps1" -Target portable %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo !! build failed, exit code %RC%
  pause
  exit /b %RC%
)

set "N=0"
for %%F in ("release\*_portable.exe") do set /a N+=1
if "%N%"=="0" (
  echo FAIL no *_portable.exe under release\
  pause
  exit /b 1
)
echo [*] found %N% portable build(s)
for %%F in ("release\*_portable.exe") do echo     %%~nxF   %%~zF bytes   modified %%~tF
pause
exit /b 0
