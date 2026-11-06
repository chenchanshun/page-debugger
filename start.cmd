@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are missing. Run npm install first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
