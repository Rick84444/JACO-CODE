@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo JACO requires Node.js 24 or newer. Install Node or use the bundled setup.
  pause
  exit /b 1
)
echo Starting JACO Terminal IDE...
node "%~dp0agents\jaco-cli.mjs" ide %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo JACO ended with error %RESULT%. Review the message above.
  pause
)
exit /b %RESULT%
