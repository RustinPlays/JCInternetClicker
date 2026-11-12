@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  set "PY=py"
) else (
  where python >nul 2>&1
  if not %ERRORLEVEL% EQU 0 (
    echo Python is not installed. Install Python 3.11 or newer from https://www.python.org/downloads/windows/
    echo Select "Add Python to PATH" and restart this launcher.
    pause
    exit /b 1
  )
  set "PY=python"
)
if not exist ".venv\Scripts\python.exe" (
  echo First run: setting up the Windows receiver...
  %PY% -m venv .venv
  if errorlevel 1 goto fail
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)
if not exist config.json (
  echo Pair this PC using the simple setup window...
  ".venv\Scripts\python.exe" setup.py
)
if not exist config.json (
  echo Pairing not completed. No changes made.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" launch.py
if errorlevel 1 goto fail
exit /b 0
:fail
echo JC Receiver could not start. Check the error above.
pause
exit /b 1
