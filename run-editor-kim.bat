@echo off
rem EDITOR_KIM launcher: checks Node, installs dependencies once, starts the app.
setlocal
cd /d "%~dp0"
title EDITOR_KIM

where node >nul 2>nul
if errorlevel 1 (
  echo [EDITOR_KIM] Node.js 22+ is required but was not found.
  echo          Download: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [EDITOR_KIM] First run: installing dependencies ^(about 1-2 minutes^)...
  call npm install
  if errorlevel 1 (
    echo [EDITOR_KIM] npm install failed. Check the messages above.
    pause
    exit /b 1
  )
)

echo [EDITOR_KIM] Starting... ^(this window shows the server log; close the app window to quit^)
call npm start
if errorlevel 1 pause
endlocal
