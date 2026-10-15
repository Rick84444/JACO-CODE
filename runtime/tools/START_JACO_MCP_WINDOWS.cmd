@echo off
setlocal
cd /d "%~dp0\.."
if "%JACO_BASE_URL%"=="" set JACO_BASE_URL=http://127.0.0.1:3000
if "%JACO_MODEL_ID%"=="" set JACO_MODEL_ID=external-model
node "%~dp0jaco-mcp-server.mjs"
