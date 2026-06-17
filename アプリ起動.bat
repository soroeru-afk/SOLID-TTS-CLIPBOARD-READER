@echo off
title SOLID TTS CLIPBOARD READER 起動
chcp 65001 > nul
cd /d "%~dp0"

if exist "C:\Users\soroe\node-v22.13.1-win-x64" (
    set "PATH=C:\Users\soroe\node-v22.13.1-win-x64;%PATH%"
)

echo アプリケーションをスタンドアロンウィンドウで起動しています...

:: Start Vite dev server in the background
start /b cmd /c npm run dev

:: Wait 2 seconds for server startup
timeout /t 2 /nobreak > nul

:: Open Chrome in standalone App window
start chrome --app="http://localhost:3000"

exit
