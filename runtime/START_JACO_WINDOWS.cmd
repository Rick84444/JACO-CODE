@echo off
setlocal
call "%~dp0START_CONTINUUM_CANDIDATE_WINDOWS.cmd" %*
exit /b %ERRORLEVEL%
