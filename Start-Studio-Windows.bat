@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (set "PY=py") else (set "PY=python")
if not exist ".venv-studio\Scripts\python.exe" (
 echo Installing JC Clicker Studio Python dependencies...
 %PY% -m venv ".venv-studio"
 if errorlevel 1 goto failed
 ".venv-studio\Scripts\python.exe" -m pip install -r "desktop\requirements.txt"
 if errorlevel 1 goto failed
)
".venv-studio\Scripts\python.exe" desktop\studio.py
if errorlevel 1 goto failed
exit /b 0
:failed
echo JC Clicker Studio could not start. Check errors above.
pause
exit /b 1
