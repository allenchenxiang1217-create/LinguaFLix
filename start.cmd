@echo off
REM LinguaFlix launcher for Windows - starts backend + frontend servers
REM Usage: start.cmd

setlocal
cd /d "%~dp0"

REM Use the operating system's trusted root certificates
set NODE_USE_SYSTEM_CA=1

echo [LinguaFlix] Starting backend on http://127.0.0.1:5176 ...
start "LinguaFlix Backend" /min cmd /c "node server\index.js --port 5176"

echo [LinguaFlix] Starting frontend on http://localhost:5173 ...
start "LinguaFlix Frontend" /min cmd /c "npx vite --config vite.config.web.ts --host"

echo.
echo [LinguaFlix] is running! Open http://localhost:5173 in your browser
echo Close the two minimized windows to stop the servers.
endlocal
