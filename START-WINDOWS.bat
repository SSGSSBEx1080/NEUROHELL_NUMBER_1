@echo off
setlocal
cd /d "%~dp0"
title FSH 777 - local editor
where node >nul 2>nul
if errorlevel 1 goto neednode
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)?0:1)"
if errorlevel 1 goto neednode
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing dependencies. Internet is needed only for this step.
  call npm ci
  if errorlevel 1 goto error
)
echo Starting FSH 777 at http://localhost:5173
echo Keep this window open. Press Ctrl+C to stop.
call npm start
if errorlevel 1 goto error
exit /b 0
:neednode
echo Please install Node.js 22.12+ or 24 LTS from https://nodejs.org/
echo Then close this window and run START-WINDOWS.bat again.
pause
exit /b 1
:error
echo Could not start. Read the error above.
echo If port 5173 is busy, close the previous editor window or run: npm run dev -- --port 5174
pause
exit /b 1
