@echo off
rem Retext PDF launcher: checks Node, installs dependencies once, starts the app.
setlocal
cd /d "%~dp0"
title Retext PDF

where node >nul 2>nul
if errorlevel 1 (
  echo [Retext PDF] Node.js 22+ is required but was not found.
  echo          Download: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [Retext PDF] First run: installing dependencies ^(about 1-2 minutes^)...
  call npm install
  if errorlevel 1 (
    echo [Retext PDF] npm install failed. Check the messages above.
    pause
    exit /b 1
  )
)

echo [Retext PDF] Starting... ^(this window shows the server log; close the app window to quit^)
call npm start
if errorlevel 1 pause
endlocal
