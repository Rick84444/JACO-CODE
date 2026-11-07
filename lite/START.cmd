@echo off
rem JACO Lite for Windows: double-click, or run START.cmd from a project folder.
if not exist "%~dp0start.mjs" (
  echo JACO Lite must be extracted before it can start.
  echo Right-click jaco-lite.zip and choose Extract All.
  echo Open the extracted folder, then double-click START.cmd there.
  echo If this is already an extracted folder, download and extract the complete package again.
  pause
  exit /b 3
)
rem The Windows download brings its own Node.js in node\, so nothing has to be installed first.
set "JACO_NODE=%~dp0node\node.exe"
if not exist "%JACO_NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js 22.5 or newer is required. Install the current LTS from https://nodejs.org and run this again.
    pause
    exit /b 2
  )
  set "JACO_NODE=node"
)
"%JACO_NODE%" "%~dp0start.mjs" %*
if errorlevel 1 pause
