@echo off
setlocal
set ROOT=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\windows\start-continuum-candidate.ps1" %*
exit /b %ERRORLEVEL%
