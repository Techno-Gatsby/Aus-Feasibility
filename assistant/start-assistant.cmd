@echo off
setlocal
title Feasibility assistant bridge

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\@anthropic-ai\claude-agent-sdk" (
  echo Installing dependencies, this runs once...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
node server.mjs

echo.
echo The bridge has stopped.
pause
