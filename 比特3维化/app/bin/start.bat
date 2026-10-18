@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.." || (echo FAIL cannot reach project root & pause & exit /b 1)
rem ASCII-only on purpose: cmd relocates lines by char count when the console codepage
rem is not 65001, so any non-ASCII byte here can make later lines execute as commands.

set "NPMCMD="
for /f "delims=" %%P in ('where npm.cmd 2^>nul') do if not defined NPMCMD set "NPMCMD=%%P"
if not defined NPMCMD set "NPMCMD=C:\Program Files\nodejs\npm.cmd"
if not exist "%NPMCMD%" (
  echo FAIL npm.cmd not found - install Node or edit the fallback path
  pause
  exit /b 1
)

if exist "node_modules\electron\dist\electron.exe" goto :have_electron
echo [*] Electron binary missing, fetching it via ensure-electron
call "%NPMCMD%" run ensure-electron
if errorlevel 1 (
  echo !! ensure-electron failed
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo !! still missing after ensure-electron
  pause
  exit /b 1
)
:have_electron

echo [*] starting vite dev server and the Electron window
echo     close this console or run stop.bat to shut it down
call "%NPMCMD%" run dev
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" echo ok dev exited cleanly
if not "%RC%"=="0" echo !! dev exited with code %RC%
pause
exit /b %RC%
