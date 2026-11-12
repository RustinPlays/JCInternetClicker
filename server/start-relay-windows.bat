@echo off
cd /d "%~dp0"
where node >nul 2>&1
if not %ERRORLEVEL% EQU 0 (
  echo Node.js is not installed. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing server dependency...
  call npm install
  if not %ERRORLEVEL% EQU 0 (
    echo npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
)
if not exist .env (
  echo First-time setup...
  call npm run setup
  if not %ERRORLEVEL% EQU 0 (
    pause
    exit /b 1
  )
)
call npm start
pause
